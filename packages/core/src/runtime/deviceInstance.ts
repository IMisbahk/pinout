import { DisconnectedError, UnsupportedCapabilityError } from '../errors.js';
import { evaluatePolicies } from '../policy/engine.js';
import type { PolicyRule } from '../policy/types.js';
import { validateInputSchema, validateOutputSchema } from '../schema.js';
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
  activeTransportKind?: string;
  transportKinds: string[];
  getOperationalState: () => Record<string, unknown>;
  onRuntimeEvent?: RuntimeEventHandler;
}

export class DeviceInstance {
  readonly identity: DeviceIdentity;
  readonly capabilities: CapabilityDescriptor[];
  readonly simulated: boolean;
  readonly activeTransportKind: string;
  readonly transportKinds: string[];

  private readonly backend: DeviceBackend;
  private readonly policies: PolicyRule[];
  private readonly getOperationalState: () => Record<string, unknown>;
  private readonly runtimeEventHandlers = new Set<RuntimeEventHandler>();
  private health: DeviceHealth;
  private activeInvocations = 0;
  private closing = false;
  private unsubscribeBackend: (() => void) | undefined;
  private protocolUnsubscribers: Array<() => void> = [];

  constructor(options: DeviceInstanceOptions) {
    this.identity = options.identity;
    this.backend = options.backend;
    this.capabilities = options.capabilities;
    this.policies = options.policies;
    this.simulated = options.simulated;
    this.activeTransportKind = options.activeTransportKind ?? options.backend.kind;
    this.transportKinds = options.transportKinds;
    this.getOperationalState = options.getOperationalState;
    if (options.onRuntimeEvent) {
      this.runtimeEventHandlers.add(options.onRuntimeEvent);
    }
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

  subscribeRuntimeEvents(handler: RuntimeEventHandler): () => void {
    this.runtimeEventHandlers.add(handler);
    return () => this.runtimeEventHandlers.delete(handler);
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
    if (this.closing || this.health.lifecycle === 'disconnected') {
      throw new DisconnectedError(`Device '${this.id}' is closing or disconnected.`);
    }
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

    this.activeInvocations += 1;
    this.setLifecycle('busy');
    try {
      const result = await this.backend.invoke(capability, payload);
      return validateOutputSchema(descriptor.outputSchema, result);
    } finally {
      this.activeInvocations -= 1;
      if (!this.closing) {
        this.setLifecycle(this.activeInvocations > 0 ? 'busy' : 'ready');
      }
    }
  }

  async close(): Promise<void> {
    if (this.closing || this.health.lifecycle === 'disconnected') {
      return;
    }
    this.closing = true;
    this.unsubscribeBackend?.();
    this.unsubscribeBackend = undefined;
    for (const unsub of this.protocolUnsubscribers.splice(0)) {
      unsub();
    }
    this.runtimeEventHandlers.clear();
    try {
      await this.backend.close();
    } finally {
      this.setLifecycle('disconnected');
    }
  }

  private emitRuntimeEvent(event: string, payload: Record<string, unknown>): void {
    const envelope: RuntimeEventEnvelope = {
      deviceId: this.id,
      event,
      payload,
      timestamp: Date.now(),
    };
    for (const handler of this.runtimeEventHandlers) {
      handler(envelope);
    }
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
