import { UnsupportedCapabilityError } from '../errors.js';
import { evaluatePolicies } from '../policy/engine.js';
import type { PolicyRule } from '../policy/types.js';
import { validateInputSchema } from '../schema.js';
import type { CapabilityDescriptor } from '../types.js';
import type {
  DeviceBackend,
  DeviceClass,
  DeviceHealth,
  DeviceIdentity,
  DeviceLifecycleStatus,
  RuntimeEventEnvelope,
  RuntimeEventHandler,
} from './types.js';

export interface DeviceInstanceOptions {
  identity: DeviceIdentity;
  backend: DeviceBackend;
  capabilities: CapabilityDescriptor[];
  policies: PolicyRule[];
  simulated: boolean;
  transportKinds: string[];
  getOperationalState: () => Record<string, unknown>;
  onRuntimeEvent?: RuntimeEventHandler;
}

export class DeviceInstance {
  readonly identity: DeviceIdentity;
  readonly capabilities: CapabilityDescriptor[];
  readonly simulated: boolean;
  readonly transportKinds: string[];

  private readonly backend: DeviceBackend;
  private readonly policies: PolicyRule[];
  private readonly getOperationalState: () => Record<string, unknown>;
  private readonly onRuntimeEvent: RuntimeEventHandler | undefined;
  private health: DeviceHealth;
  private unsubscribeBackend: (() => void) | undefined;
  private protocolUnsubscribers: Array<() => void> = [];

  constructor(options: DeviceInstanceOptions) {
    this.identity = options.identity;
    this.backend = options.backend;
    this.capabilities = options.capabilities;
    this.policies = options.policies;
    this.simulated = options.simulated;
    this.transportKinds = options.transportKinds;
    this.getOperationalState = options.getOperationalState;
    this.onRuntimeEvent = options.onRuntimeEvent;
    this.health = {
      lifecycle: 'ready',
      lastUpdated: Date.now(),
    };

    this.unsubscribeBackend = this.backend.subscribe((event, payload) => {
      if (!event) {
        return;
      }
      this.emitRuntimeEvent(event, payload);
    });
  }

  get id(): string {
    return this.identity.id;
  }

  get deviceClass(): DeviceClass {
    return this.identity.deviceClass;
  }

  get moduleId(): string {
    return this.identity.moduleId;
  }

  getHealth(): DeviceHealth {
    return { ...this.health };
  }

  getOperationalStateSnapshot(): Record<string, unknown> {
    return { ...this.getOperationalState() };
  }

  capabilityNames(): string[] {
    return this.capabilities.map((capability) => capability.name);
  }

  supports(capability: string): boolean {
    return this.capabilityNames().includes(capability);
  }

  attachProtocolEventBridge(
    subscribe: (event: string, handler: (payload: Record<string, unknown>) => void) => void,
    unsubscribe: (event: string, handler: (payload: Record<string, unknown>) => void) => void,
    events: string[],
  ): void {
    for (const event of events) {
      const handler = (payload: Record<string, unknown>): void => {
        this.emitRuntimeEvent(event, payload);
      };
      subscribe(event, handler);
      this.protocolUnsubscribers.push(() => unsubscribe(event, handler));
    }
  }

  async invoke(
    capability: string,
    input: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> {
    if (!this.supports(capability)) {
      throw new UnsupportedCapabilityError(capability);
    }

    const descriptor = this.resolveCapability(capability);
    const payload = validateInputSchema(descriptor.inputSchema, input);

    evaluatePolicies(this.policies, {
      deviceId: this.id,
      capability,
      payload,
      operationalState: this.getOperationalState(),
    });

    this.setLifecycle('busy');
    try {
      const result = await this.backend.invoke(capability, payload);
      this.setLifecycle('ready');
      return result;
    } catch (error) {
      this.setLifecycle('ready');
      throw error;
    }
  }

  async close(): Promise<void> {
    this.unsubscribeBackend?.();
    this.unsubscribeBackend = undefined;
    for (const unsub of this.protocolUnsubscribers.splice(0)) {
      unsub();
    }
    this.setLifecycle('disconnected');
    await this.backend.close();
  }

  private emitRuntimeEvent(event: string, payload: Record<string, unknown>): void {
    const envelope: RuntimeEventEnvelope = {
      deviceId: this.id,
      event,
      payload,
      timestamp: Date.now(),
    };
    this.onRuntimeEvent?.(envelope);
  }

  private setLifecycle(lifecycle: DeviceLifecycleStatus): void {
    this.health = { lifecycle, lastUpdated: Date.now() };
  }

  private resolveCapability(capability: string): CapabilityDescriptor {
    const match = this.capabilities.find((entry) => entry.name === capability);
    if (!match) {
      throw new UnsupportedCapabilityError(capability);
    }
    return match;
  }
}
