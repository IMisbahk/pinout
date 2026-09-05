import { DisconnectedError, UnsupportedCapabilityError, PinoutError, PinoutStructuredError } from '../errors.js';
import { evaluatePolicies } from '../policy/engine.js';
import type { SafetyEngine, SafetyReservation } from '../policy/safety.js';
import type { PolicyRule } from '../policy/types.js';
import type { HaltCoordinator } from '../halt/haltCoordinator.js';
import { validateInputSchema, validateOutputSchema } from '../schema.js';
import type { CapabilityDescriptor } from '../types.js';
import {
  computeFreshness,
  formatIsoTimestamp,
  recordAcknowledged,
  recordCommanded,
  recordObserved,
  unknownEvidence,
  type DeviceStateEvidence,
  type EvidenceProvenance,
  type EvidenceSource,
  type EvidenceState,
  type EvidenceValue,
  type StatePrerequisite,
} from '../spec/evidence.js';
import type {
  DeviceBackend,
  DeviceClass,
  DeviceHealth,
  DeviceIdentity,
  DeviceLifecycleStatus,
  RuntimeEventEnvelope,
  RuntimeEventHandler,
} from './types.js';

export type { DeviceBackend } from './types.js';

export interface DeviceInstanceOptions {
  identity: DeviceIdentity;
  backend: DeviceBackend;
  capabilities: CapabilityDescriptor[];
  policies: PolicyRule[];
  simulated: boolean;
  activeTransportKind?: string;
  transportKinds: string[];
  getOperationalState: () => Record<string, unknown>;
  getOperationalStateEvidence?: (() => Record<string, EvidenceState<unknown>>) | undefined;
  prerequisites?: Record<string, StatePrerequisite[]> | undefined;
  maxStateAgeMs?: number | Record<string, number> | undefined;
  onRuntimeEvent?: RuntimeEventHandler | undefined;
  /** Global safety halt gate consulted before physical invocations. */
  halt?: HaltCoordinator | undefined;
  /**
   * Safety engine v2 for rate/interlock/sequence/approval/lease/deadman/
   * resource rules. Give it ONLY v2 rules; the legacy kinds in `policies`
   * are already evaluated on every invoke.
   */
  safetyEngine?: SafetyEngine | undefined;
}

/** Per-invocation options (leases, dry-run). */
export interface InvokeOptions {
  /** Lease owner asserting control; required by lease-gated capabilities. */
  owner?: string;
  /** Resolve and policy-check without executing any physical side effect. */
  dryRun?: boolean;
  /** Abort an in-flight backend request or long-running semantic action. */
  signal?: AbortSignal;
  /** Forward semantic progress to the operation manager. */
  reportProgress?: (fraction: number | null, message?: string) => void;
}

export class DeviceInstance {
  readonly identity: DeviceIdentity;
  readonly capabilities: CapabilityDescriptor[];
  readonly simulated: boolean;
  readonly activeTransportKind: string;
  readonly transportKinds: string[];

  private readonly backend: DeviceBackend;
  private readonly policies: PolicyRule[];
  private halt: HaltCoordinator | undefined;
  private safetyEngine: SafetyEngine | undefined;
  private readonly getOperationalState: () => Record<string, unknown>;
  private readonly getOperationalStateEvidenceFn: (() => Record<string, EvidenceState<unknown>>) | undefined;
  private readonly evidenceMap = new Map<string, EvidenceState<unknown>>();
  private readonly prerequisitesMap = new Map<string, StatePrerequisite[]>();
  private readonly maxStateAgeMap = new Map<string, number>();
  private defaultMaxStateAgeMs: number | undefined;
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
    this.getOperationalStateEvidenceFn =
      options.getOperationalStateEvidence ??
      (options.backend.getOperationalStateEvidence
        ? () => options.backend.getOperationalStateEvidence!()
        : undefined);
    this.halt = options.halt;
    this.safetyEngine = options.safetyEngine;

    if (typeof options.maxStateAgeMs === 'number') {
      this.defaultMaxStateAgeMs = options.maxStateAgeMs;
    } else if (options.maxStateAgeMs && typeof options.maxStateAgeMs === 'object') {
      for (const [key, maxAge] of Object.entries(options.maxStateAgeMs)) {
        this.maxStateAgeMap.set(key, maxAge);
      }
    }

    if (options.prerequisites) {
      for (const [capability, reqs] of Object.entries(options.prerequisites)) {
        this.prerequisitesMap.set(capability, [...reqs]);
      }
    }

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
      this.handleIncomingEvent(event, payload);
    });
  }

  /**
   * Attach the runtime-owned governance boundary to this device.
   *
   * Runtime registration deliberately overwrites any device-local wiring so
   * a device cannot bypass the runtime halt or safety engine.
   */
  attachGovernance(halt: HaltCoordinator, safetyEngine: SafetyEngine): void {
    this.halt = halt;
    this.safetyEngine = safetyEngine;
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

  get provenance(): EvidenceProvenance {
    return this.simulated ? 'simulated' : 'hardware';
  }

  getHealth(): DeviceHealth {
    return { ...this.health };
  }

  getOperationalStateSnapshot(): Record<string, unknown> {
    return { ...this.getOperationalState() };
  }

  getMaxAgeMs(key: string): number | undefined {
    return this.maxStateAgeMap.get(key) ?? this.defaultMaxStateAgeMs;
  }

  setMaxAgeMs(keyOrAge: string | number, maxAgeMs?: number): void {
    if (typeof keyOrAge === 'number') {
      this.defaultMaxStateAgeMs = keyOrAge;
    } else if (typeof maxAgeMs === 'number') {
      this.maxStateAgeMap.set(keyOrAge, maxAgeMs);
    }
  }

  setPrerequisite(capability: string, prerequisite: StatePrerequisite): void {
    const current = this.prerequisitesMap.get(capability) ?? [];
    current.push(prerequisite);
    this.prerequisitesMap.set(capability, current);
  }

  getStateEvidence(): DeviceStateEvidence {
    const snapshot: DeviceStateEvidence = {};
    const now = Date.now();

    // 1. Backend-provided evidence if available
    const backendEvidence = this.getOperationalStateEvidenceFn?.() ?? {};
    for (const [key, state] of Object.entries(backendEvidence)) {
      snapshot[key] = computeFreshness(state, now, this.getMaxAgeMs(key));
    }

    // 2. Check if getOperationalState returns evidence-shaped fields (e.g., status/lamp)
    const opState = this.getOperationalState();
    if (
      opState &&
      typeof opState === 'object' &&
      'commanded' in opState &&
      'acknowledged' in opState &&
      'observed' in opState
    ) {
      const lampEvidence: EvidenceState<unknown> = {
        commanded: (opState.commanded as EvidenceValue<unknown>) ?? { value: null, at: null, source: 'none' },
        acknowledged: (opState.acknowledged as EvidenceValue<unknown>) ?? { value: null, at: null, source: 'none' },
        observed: (opState.observed as EvidenceValue<unknown>) ?? { value: null, at: null, source: 'none' },
        freshnessMs: typeof opState.freshnessMs === 'number' ? opState.freshnessMs : null,
        stale: false,
        provenance: (opState.provenance as EvidenceProvenance) ?? this.provenance,
      };
      snapshot.status = computeFreshness(lampEvidence, now, this.getMaxAgeMs('status'));
    }

    // 3. Local instance evidence
    for (const [key, state] of this.evidenceMap.entries()) {
      snapshot[key] = computeFreshness(state, now, this.getMaxAgeMs(key));
    }

    return snapshot;
  }

  getEvidence(key: string): EvidenceState<unknown> | undefined {
    return this.getStateEvidence()[key];
  }

  recordCommandedState<T = unknown>(
    key: string,
    value: T | null,
    at?: string | number | Date | null,
  ): EvidenceState<T> {
    const existing =
      (this.evidenceMap.get(key) as EvidenceState<T> | undefined) ??
      unknownEvidence<T>(this.provenance);
    const updated = recordCommanded(existing, value, at, this.provenance);
    this.evidenceMap.set(key, updated as EvidenceState<unknown>);
    return updated;
  }

  recordAcknowledgedState<T = unknown>(
    key: string,
    value: T | null,
    at?: string | number | Date | null,
  ): EvidenceState<T> {
    const existing =
      (this.evidenceMap.get(key) as EvidenceState<T> | undefined) ??
      unknownEvidence<T>(this.provenance);
    const updated = recordAcknowledged(existing, value, at, this.provenance);
    this.evidenceMap.set(key, updated as EvidenceState<unknown>);
    return updated;
  }

  recordObservedState<T = unknown>(
    key: string,
    value: T | null,
    source: 'gpio-readback' | 'sensor' | 'simulated' = this.simulated ? 'simulated' : 'sensor',
    at?: string | number | Date | null,
  ): EvidenceState<T> {
    const existing =
      (this.evidenceMap.get(key) as EvidenceState<T> | undefined) ??
      unknownEvidence<T>(this.provenance);
    const updated = recordObserved(existing, value, source, at, this.provenance, this.getMaxAgeMs(key));
    this.evidenceMap.set(key, updated as EvidenceState<unknown>);
    return updated;
  }

  evaluatePrerequisites(capability: string): void {
    const prerequisites = this.prerequisitesMap.get(capability) ?? [];
    if (prerequisites.length === 0) {
      return;
    }

    const allEvidence = this.getStateEvidence();
    const now = Date.now();

    for (const prereq of prerequisites) {
      const evidence = allEvidence[prereq.key];

      // Missing check: no evidence or observed value is null or source is 'none'
      if (
        !evidence ||
        evidence.observed.value === null ||
        evidence.observed.at === null ||
        evidence.observed.source === 'none'
      ) {
        throw new PinoutStructuredError(
          'PREREQUISITE_MISSING',
          'SAFETY',
          `Prerequisite '${prereq.key}' is missing or has no observed physical evidence for capability '${capability}'.`,
          {
            device: this.id,
            capability,
            details: {
              key: prereq.key,
              expectedValue: prereq.expectedValue,
              observedValue: evidence?.observed.value ?? null,
              observedSource: evidence?.observed.source ?? 'none',
              observedAt: evidence?.observed.at ?? null,
            },
          },
        );
      }

      // Expected value match check
      if (prereq.expectedValue !== undefined && evidence.observed.value !== prereq.expectedValue) {
        throw new PinoutStructuredError(
          'PREREQUISITE_MISSING',
          'SAFETY',
          `Prerequisite '${prereq.key}' expected value '${String(prereq.expectedValue)}' but observed '${String(evidence.observed.value)}' for capability '${capability}'.`,
          {
            device: this.id,
            capability,
            details: {
              key: prereq.key,
              expectedValue: prereq.expectedValue,
              observedValue: evidence.observed.value,
              observedSource: evidence.observed.source,
              observedAt: evidence.observed.at,
            },
          },
        );
      }

      // Staleness check
      const maxAge = prereq.maxAgeMs ?? this.getMaxAgeMs(prereq.key);
      if (maxAge !== undefined) {
        const obsMs = new Date(evidence.observed.at).getTime();
        const ageMs = now - obsMs;
        if (ageMs > maxAge || ageMs < 0 || Number.isNaN(obsMs)) {
          throw new PinoutStructuredError(
            'PREREQUISITE_STALE',
            'SAFETY',
            `Prerequisite '${prereq.key}' observed value is stale (${ageMs}ms > maxAge ${maxAge}ms) for capability '${capability}'.`,
            {
              device: this.id,
              capability,
              details: {
                key: prereq.key,
                maxAgeMs: maxAge,
                ageMs,
                observedAt: evidence.observed.at,
                observedValue: evidence.observed.value,
              },
            },
          );
        }
      }
    }
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
        this.handleIncomingEvent(event, payload);
      };
      subscribe(event, handler);
      this.protocolUnsubscribers.push(() => unsubscribe(event, handler));
    }
  }

  async invoke(
    capability: string,
    input: Record<string, unknown> = {},
    options: InvokeOptions = {},
  ): Promise<Record<string, unknown>> {
    if (this.closing || this.health.lifecycle === 'disconnected') {
      throw new DisconnectedError(`Device '${this.id}' is closing or disconnected.`);
    }
    if (!this.supports(capability)) {
      throw new UnsupportedCapabilityError(capability);
    }

    const descriptor = this.resolveCapability(capability);
    const payload = validateInputSchema(descriptor.inputSchema, input);

    // Prerequisite check: reject before any mutation or side-effect
    this.evaluatePrerequisites(capability);

    // Safety order: halt gate (skipped for dry-run: planning during a halt
    // is safe and useful — nothing executes) → legacy policies → v2 rules.
    if (!options.dryRun) {
      this.halt?.enforceGate();
    }
    evaluatePolicies(this.policies, {
      deviceId: this.id,
      capability,
      payload,
      operationalState: this.getOperationalState(),
    });
    let safetyReservation: SafetyReservation | undefined;
    if (this.safetyEngine) {
      const context = {
        deviceId: this.id,
        capability,
        payload,
        operationalState: this.getOperationalState(),
        ...(options.owner !== undefined ? { owner: options.owner } : {}),
      };
      if (options.dryRun) {
        const decision = this.safetyEngine.preview(context);
        if (!decision.allowed)
          throw new PinoutError(
            decision.code ?? 'POLICY_ACTION_DENIED',
            decision.message ?? 'Rejected by policy.',
          );
      } else {
        safetyReservation = this.safetyEngine.reserve(context);
      }
    }

    if (options.dryRun) {
      // Everything above is the full resolution/validation/policy pass;
      // a dry run stops here, before any physical side effect.
      return {
        dryRun: true,
        deviceId: this.id,
        capability,
        resolvedArgs: payload,
        haltState: this.halt?.state ?? 'NORMAL',
      };
    }

    // Record commanded state
    const nowIso = formatIsoTimestamp();
    for (const [k, v] of Object.entries(payload)) {
      this.recordCommandedState(k, v, nowIso);
    }
    if (typeof payload.pin === 'number') {
      this.recordCommandedState(`gpio.${payload.pin}`, payload.value ?? null, nowIso);
    }

    this.activeInvocations += 1;
    this.setLifecycle('busy');
    try {
      let result: Record<string, unknown>;
      try {
        result = await this.backend.invoke(capability, payload, {
          ...(options.signal ? { signal: options.signal } : {}),
          ...(options.reportProgress ? { reportProgress: options.reportProgress } : {}),
        });
      } catch (error) {
        safetyReservation?.rollback();
        throw error;
      }
      safetyReservation?.commit();

      const validated = validateOutputSchema(descriptor.outputSchema, result);
      const ackIso = formatIsoTimestamp();

      // Record acknowledged state on successful execution
      for (const [k, v] of Object.entries(validated)) {
        this.recordAcknowledgedState(k, v, ackIso);
      }
      if (typeof validated.pin === 'number') {
        this.recordAcknowledgedState(`gpio.${validated.pin}`, validated.value ?? null, ackIso);
      }

      // DO NOT infer physical success: only independent reads or sensor queries update observed state!
      const isReadAction =
        !descriptor.safety.physicalOutput ||
        capability.endsWith('.read') ||
        capability === 'gpio.read' ||
        capability.startsWith('sensor.');

      if (isReadAction) {
        const source: EvidenceSource = this.simulated ? 'simulated' : 'sensor';
        for (const [k, v] of Object.entries(validated)) {
          this.recordObservedState(k, v, source, ackIso);
        }
        if (typeof validated.pin === 'number' && validated.value !== undefined) {
          const pinSource: EvidenceSource = this.simulated ? 'simulated' : 'gpio-readback';
          this.recordObservedState(`gpio.${validated.pin}`, validated.value, pinSource, ackIso);
          if (validated.value !== undefined) {
            this.recordObservedState('value', validated.value, pinSource, ackIso);
          }
        }
      }

      return validated;
    } finally {
      this.activeInvocations -= 1;
      if (!this.closing) {
        this.setLifecycle(this.activeInvocations > 0 ? 'busy' : 'ready');
      }
    }
  }

  /** Apply this backend's explicit safe state outside normal actuation gates. */
  async applySafeState(): Promise<Record<string, unknown> | undefined> {
    const result = await this.backend.safeState?.();
    return result === undefined ? undefined : result;
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

  private handleIncomingEvent(event: string, payload: Record<string, unknown>): void {
    const nowIso = formatIsoTimestamp();
    if (event === 'gpio.changed' && typeof payload.pin === 'number' && payload.value !== undefined) {
      const source: EvidenceSource = this.simulated ? 'simulated' : 'gpio-readback';
      this.recordObservedState(`gpio.${payload.pin}`, payload.value, source, nowIso);
      this.recordObservedState('value', payload.value, source, nowIso);
    } else if (event.endsWith('.changed') || event.endsWith('.reading') || event.endsWith('.sample')) {
      const source: EvidenceSource = this.simulated ? 'simulated' : 'sensor';
      for (const [k, v] of Object.entries(payload)) {
        if (k !== 'driver' && k !== 'event') {
          this.recordObservedState(k, v, source, nowIso);
        }
      }
    }
    this.emitRuntimeEvent(event, payload);
  }

  private emitRuntimeEvent(event: string, payload: Record<string, unknown>): void {
    const envelope: RuntimeEventEnvelope = {
      deviceId: this.id,
      event,
      payload,
      timestamp: Date.now(),
      stateEvidence: this.getStateEvidence(),
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
