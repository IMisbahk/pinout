import { DeviceError } from '../errors.js';
import type { PolicyRule } from '../policy/types.js';
import type { CapabilityDescriptor } from '../types.js';
import type { DeviceBackend, RuntimeEventEnvelope } from './types.js';
import { DeviceInstance } from './deviceInstance.js';

/** A capability-to-driver binding used by multi-driver devices. */
export interface CompositeRoute {
  driver: string;
  /** Optional action name when the driver's API differs from the public capability. */
  action?: string;
}

export interface CompositeBackendOptions {
  drivers: Record<string, DeviceBackend>;
  routes: Record<string, CompositeRoute>;
  closeDrivers?: boolean;
}

/**
 * Routes a single public capability surface across several physical drivers.
 * Driver events are forwarded with a `driver` field while preserving the event name.
 */
export class CompositeDeviceBackend implements DeviceBackend {
  readonly kind = 'composite' as const;
  private readonly drivers: Readonly<Record<string, DeviceBackend>>;
  private readonly routes: Readonly<Record<string, CompositeRoute>>;
  private readonly closeDrivers: boolean;
  private readonly listeners = new Set<(event: string, payload: Record<string, unknown>) => void>();
  private readonly unsubs: Array<() => void> = [];
  private closed = false;

  constructor(options: CompositeBackendOptions) {
    const driverOwners = new Map<DeviceBackend, string>();
    for (const [name, driver] of Object.entries(options.drivers)) {
      const existing = driverOwners.get(driver);
      if (existing) {
        throw new DeviceError(
          'DEVICE_ERROR',
          `Driver backend is registered twice as '${existing}' and '${name}'. Use one driver name with multiple routes.`,
        );
      }
      driverOwners.set(driver, name);
    }
    for (const [capability, route] of Object.entries(options.routes)) {
      if (!options.drivers[route.driver]) {
        throw new DeviceError(
          'DEVICE_ERROR',
          `Route '${capability}' references missing driver '${route.driver}'.`,
        );
      }
    }
    this.drivers = options.drivers;
    this.routes = options.routes;
    this.closeDrivers = options.closeDrivers ?? true;
    for (const [name, driver] of Object.entries(this.drivers)) {
      this.unsubs.push(
        driver.subscribe((event, payload) => {
          this.emit(event, { ...payload, driver: name });
        }),
      );
    }
  }

  subscribe(handler: (event: string, payload: Record<string, unknown>) => void): () => void {
    this.listeners.add(handler);
    return () => this.listeners.delete(handler);
  }

  async invoke(
    capability: string,
    payload: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    if (this.closed) throw new DeviceError('DISCONNECTED', 'Composite device is closed.');
    const route = this.routes[capability];
    if (!route) throw new DeviceError('UNKNOWN_ACTION', `No driver route for '${capability}'.`);
    const driver = this.drivers[route.driver];
    if (!driver)
      throw new DeviceError('DEVICE_ERROR', `Composite driver '${route.driver}' is unavailable.`);
    return driver.invoke(route.action ?? capability, payload);
  }

  getOperationalState(): Record<string, unknown> {
    const state: Record<string, unknown> = {};
    for (const [name, driver] of Object.entries(this.drivers)) {
      if (driver.getOperationalState) state[name] = driver.getOperationalState();
    }
    return state;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    for (const unsubscribe of this.unsubs.splice(0)) unsubscribe();
    this.listeners.clear();
    if (this.closeDrivers)
      await Promise.all(Object.values(this.drivers).map((driver) => driver.close()));
  }

  private emit(event: string, payload: Record<string, unknown>): void {
    for (const listener of this.listeners) listener(event, payload);
  }
}

export function createCompositeBackend(options: CompositeBackendOptions): DeviceBackend {
  return new CompositeDeviceBackend(options);
}

export interface CreateCompositeDeviceOptions extends CompositeBackendOptions {
  id: string;
  moduleId: string;
  deviceClass: string;
  capabilities: CapabilityDescriptor[];
  policies?: PolicyRule[];
  label?: string;
  vendor?: string;
  model?: string;
  simulated?: boolean;
  transportKinds?: string[];
  onRuntimeEvent?: (event: RuntimeEventEnvelope) => void;
}

/** Construct a policy-enforced DeviceInstance over multiple independently managed drivers. */
export function createCompositeDevice(options: CreateCompositeDeviceOptions): DeviceInstance {
  const capabilityNames = new Set<string>();
  for (const capability of options.capabilities) {
    if (capabilityNames.has(capability.name)) {
      throw new DeviceError(
        'DEVICE_ERROR',
        `Composite device declares duplicate capability '${capability.name}'.`,
      );
    }
    capabilityNames.add(capability.name);
    if (!options.routes[capability.name]) {
      throw new DeviceError(
        'DEVICE_ERROR',
        `Composite device capability '${capability.name}' has no driver route.`,
      );
    }
  }
  for (const routedCapability of Object.keys(options.routes)) {
    if (!capabilityNames.has(routedCapability)) {
      throw new DeviceError(
        'DEVICE_ERROR',
        `Composite route '${routedCapability}' has no declared capability.`,
      );
    }
  }
  const identity = {
    id: options.id,
    moduleId: options.moduleId,
    deviceClass: options.deviceClass,
    ...(options.label ? { label: options.label } : {}),
    ...(options.vendor ? { vendor: options.vendor } : {}),
    ...(options.model ? { model: options.model } : {}),
  };
  const backend = createCompositeBackend(options);
  return new DeviceInstance({
    identity,
    backend,
    capabilities: options.capabilities,
    policies: options.policies ?? [],
    simulated:
      options.simulated ??
      Object.values(options.drivers).every((driver) => driver.kind === 'simulated'),
    activeTransportKind: 'composite',
    transportKinds: options.transportKinds ?? [
      ...new Set(Object.values(options.drivers).map((driver) => driver.kind)),
    ],
    getOperationalState: () => backend.getOperationalState?.() ?? {},
    ...(options.onRuntimeEvent ? { onRuntimeEvent: options.onRuntimeEvent } : {}),
  });
}

/** Convenience descriptor for applications that expose a composite as a module. */
