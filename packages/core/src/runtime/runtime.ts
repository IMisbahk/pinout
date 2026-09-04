import { PinoutError } from '../errors.js';
import { HaltCoordinator, type SafetyStateChange } from '../halt/haltCoordinator.js';
import { mergeModulePolicies } from '../module/policies.js';
import { getModule } from '../modules/registry.js';
import { SafetyEngine } from '../policy/safety.js';
import { DeviceInstance, type InvokeOptions } from './deviceInstance.js';
import { ProtocolDeviceBackend } from './protocolBackend.js';
import { createRuntimeFromConfig, type FromConfigOptions } from './fromConfig.js';
import type {
  DeviceIdentity,
  DeviceSummary,
  PinoutModuleDefinition,
  RegisterModuleDeviceOptions,
  RuntimeEventEnvelope,
  RuntimeEventHandler,
} from './types.js';

export interface PinoutRuntimeOptions {
  /** Shared software halt gate for every registered device. */
  halt?: HaltCoordinator;
  /** Shared v2 safety engine for every registered device. */
  safetyEngine?: SafetyEngine;
}

export class DuplicateDeviceError extends PinoutError {
  constructor(id: string) {
    super('DUPLICATE_DEVICE', `Device '${id}' is already registered.`);
  }
}

export class DeviceNotFoundError extends PinoutError {
  constructor(id: string) {
    super('DEVICE_NOT_FOUND', `No device registered with id '${id}'.`);
  }
}

export class PinoutRuntime {
  readonly halt: HaltCoordinator;
  readonly safetyEngine: SafetyEngine;
  private readonly deviceMap = new Map<string, DeviceInstance>();
  private readonly handlers = new Set<RuntimeEventHandler>();
  private readonly deviceEventUnsubscribers = new Map<string, () => void>();
  private safeStateChain: Promise<void> = Promise.resolve();

  constructor(options: PinoutRuntimeOptions = {}) {
    this.halt = options.halt ?? new HaltCoordinator();
    this.safetyEngine = options.safetyEngine ?? new SafetyEngine({ rules: [] });
    this.halt.subscribe((change) => this.onSafetyStateChange(change));
  }

  static async fromConfig(options: FromConfigOptions = {}): Promise<PinoutRuntime> {
    const { runtime } = await createRuntimeFromConfig(options);
    return runtime;
  }

  on(handler: RuntimeEventHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  devices(): DeviceSummary[] {
    return [...this.deviceMap.values()].map((device) => {
      const summary: DeviceSummary = {
        id: device.id,
        deviceClass: device.identity.deviceClass,
        moduleId: device.moduleId,
        activeTransportKind: device.activeTransportKind,
        lifecycle: device.getHealth().lifecycle,
        simulated: device.simulated,
      };
      if (device.identity.vendor !== undefined) {
        summary.vendor = device.identity.vendor;
      }
      if (device.identity.model !== undefined) {
        summary.model = device.identity.model;
      }
      if (device.identity.label !== undefined) {
        summary.label = device.identity.label;
      }
      return summary;
    });
  }

  getDevice(id: string): DeviceInstance {
    const device = this.deviceMap.get(id);
    if (!device) {
      throw new DeviceNotFoundError(id);
    }
    return device;
  }

  hasDevice(id: string): boolean {
    return this.deviceMap.has(id);
  }

  async registerFromModule(
    moduleId: string,
    options: RegisterModuleDeviceOptions,
  ): Promise<DeviceInstance> {
    const module = getModule(moduleId);
    return this.registerModuleDevice(module, options);
  }

  async registerModuleDevice(
    module: PinoutModuleDefinition,
    options: RegisterModuleDeviceOptions,
  ): Promise<DeviceInstance> {
    if (this.deviceMap.has(options.id)) {
      throw new DuplicateDeviceError(options.id);
    }

    const simulated = options.simulated ?? !options.transport;
    let backend;

    if (options.transport && module.createProtocolBackend) {
      backend = await module.createProtocolBackend({
        transport: options.transport,
        ...options.backendOptions,
      });
    } else if (simulated && module.createSimulatedBackend) {
      backend = module.createSimulatedBackend(options.backendOptions ?? {});
    } else if (module.createProtocolBackend) {
      backend = await module.createProtocolBackend({
        ...options.backendOptions,
      });
    } else {
      throw new Error(`Module '${module.id}' cannot create a backend for this registration.`);
    }

    const identity: DeviceIdentity = {
      id: options.id,
      moduleId: module.id,
      deviceClass: module.deviceClass,
    };
    if (module.vendor !== undefined) {
      identity.vendor = module.vendor;
    }
    if (module.model !== undefined) {
      identity.model = module.model;
    }
    if (options.label !== undefined) {
      identity.label = options.label;
    }

    const instance = new DeviceInstance({
      identity,
      backend,
      capabilities: module.capabilities,
      policies: mergeModulePolicies(module.policies, options.deploymentPolicies ?? []),
      simulated,
      activeTransportKind: options.transport?.kind ?? backend.kind,
      transportKinds: module.supportedTransportKinds,
      getOperationalState: () => backend.getOperationalState?.() ?? {},
      halt: this.halt,
      safetyEngine: this.safetyEngine,
    });

    if (backend instanceof ProtocolDeviceBackend) {
      const device = backend.getDevice();
      instance.attachProtocolEventBridge(
        (event, handler) => device.on(event, handler),
        (event, handler) => device.off(event, handler),
        ['gpio.changed'],
      );
    }

    await this.register(instance);
    return instance;
  }

  async register(device: DeviceInstance): Promise<void> {
    if (this.deviceMap.has(device.id)) {
      throw new DuplicateDeviceError(device.id);
    }
    device.attachGovernance(this.halt, this.safetyEngine);
    const unsubscribe = device.subscribeRuntimeEvents((event) => this.emit(event));
    this.deviceEventUnsubscribers.set(device.id, unsubscribe);
    this.deviceMap.set(device.id, device);
  }

  async unregister(id: string): Promise<void> {
    const device = this.getDevice(id);
    try {
      await device.close();
    } finally {
      this.deviceEventUnsubscribers.get(id)?.();
      this.deviceEventUnsubscribers.delete(id);
      this.deviceMap.delete(id);
    }
  }

  async invoke(
    deviceId: string,
    capability: string,
    input: Record<string, unknown> = {},
    options: InvokeOptions = {},
  ): Promise<Record<string, unknown>> {
    return this.getDevice(deviceId).invoke(capability, input, options);
  }

  async close(): Promise<void> {
    const ids = [...this.deviceMap.keys()];
    for (const id of ids) {
      await this.unregister(id);
    }
  }

  /** Wait until safe-state work requested by halt/estop has completed. */
  async waitForSafeState(): Promise<void> {
    await this.safeStateChain;
  }

  private onSafetyStateChange(change: SafetyStateChange): void {
    if (change.to !== 'HALTED' && change.to !== 'ESTOP_REQUESTED') return;
    this.safeStateChain = this.safeStateChain.then(async () => {
      await Promise.all(
        [...this.deviceMap.values()].map(async (device) => {
          try {
            const result = await device.applySafeState();
            this.emit({
              deviceId: device.id,
              event: 'device.safe_state_applied',
              payload: result ?? { applied: false, reason: 'safe-state-not-supported' },
              timestamp: Date.now(),
            });
          } catch (error) {
            this.emit({
              deviceId: device.id,
              event: 'device.safe_state_failed',
              payload: { message: error instanceof Error ? error.message : String(error) },
              timestamp: Date.now(),
            });
          }
        }),
      );
    });
  }

  private emit(event: RuntimeEventEnvelope): void {
    for (const handler of this.handlers) {
      handler(event);
    }
  }
}
