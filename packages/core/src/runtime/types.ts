import type { CapabilityDescriptor, Transport } from '../types.js';
import type { PolicyRule } from '../policy/types.js';
import type { EvidenceState, StatePrerequisite } from '../spec/evidence.js';

export type {
  EvidenceSource,
  EvidenceProvenance,
  EvidenceValue,
  EvidenceState,
  StatePrerequisite,
  DeviceStateEvidence,
} from '../spec/evidence.js';

export type DeviceClass = string;

export type DeviceLifecycleStatus =
  'connecting' | 'ready' | 'busy' | 'faulted' | 'stopped' | 'disconnected';

export interface DeviceIdentity {
  id: string;
  moduleId: string;
  deviceClass: DeviceClass;
  vendor?: string;
  model?: string;
  label?: string;
}

export interface DeviceHealth {
  lifecycle: DeviceLifecycleStatus;
  message?: string;
  lastUpdated: number;
}

export interface DeviceDescriptor extends DeviceIdentity {
  capabilities: string[];
  activeTransportKind: string;
  transportKinds: string[];
  simulated: boolean;
}

export interface RuntimeEventEnvelope {
  deviceId: string;
  event: string;
  payload: Record<string, unknown>;
  timestamp: number;
  stateEvidence?: Record<string, EvidenceState<unknown>>;
}

export type RuntimeEventHandler = (event: RuntimeEventEnvelope) => void;

export interface BackendInvocationContext {
  signal?: AbortSignal;
  reportProgress?: (fraction: number | null, message?: string) => void;
}

export interface DeviceBackend {
  readonly kind: 'protocol' | 'simulated' | 'composite';
  invoke(
    action: string,
    payload: Record<string, unknown>,
    context?: BackendInvocationContext,
  ): Promise<Record<string, unknown>>;
  close(): Promise<void>;
  subscribe(handler: (event: string, payload: Record<string, unknown>) => void): () => void;
  getOperationalState?(): Record<string, unknown>;
  getOperationalStateEvidence?(): Record<string, EvidenceState<unknown>>;
  /** Best-effort command that places this backend in its module-defined safe state. */
  safeState?(): Promise<Record<string, unknown> | void>;
}

export interface PinoutModuleDefinition {
  id: string;
  version: string;
  deviceClass: DeviceClass;
  vendor?: string;
  model?: string;
  capabilities: CapabilityDescriptor[];
  capabilityNames: string[];
  policies: PolicyRule[];
  supportedTransportKinds: string[];
  createSimulatedBackend?(options?: Record<string, unknown>): DeviceBackend;
  createProtocolBackend?(options: Record<string, unknown>): Promise<DeviceBackend>;
}

export interface RegisterModuleDeviceOptions {
  id: string;
  label?: string;
  simulated?: boolean;
  transport?: Transport;
  backendOptions?: Record<string, unknown>;
  deploymentPolicies?: PolicyRule[];
  prerequisites?: Record<string, StatePrerequisite[]>;
  maxStateAgeMs?: number | Record<string, number>;
}

export interface DeviceSummary {
  id: string;
  deviceClass: DeviceClass;
  moduleId: string;
  activeTransportKind: string;
  lifecycle: DeviceLifecycleStatus;
  simulated: boolean;
  vendor?: string;
  model?: string;
  label?: string;
  stateEvidence?: Record<string, EvidenceState<unknown>>;
}
