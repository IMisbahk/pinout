import type { CapabilityDescriptor, Transport } from '../types.js';
import type { PolicyRule } from '../policy/types.js';

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
  transportKinds: string[];
  simulated: boolean;
}

export interface RuntimeEventEnvelope {
  deviceId: string;
  event: string;
  payload: Record<string, unknown>;
  timestamp: number;
}

export type RuntimeEventHandler = (event: RuntimeEventEnvelope) => void;

export interface DeviceBackend {
  readonly kind: 'protocol' | 'simulated';
  invoke(action: string, payload: Record<string, unknown>): Promise<Record<string, unknown>>;
  close(): Promise<void>;
  subscribe(handler: (event: string, payload: Record<string, unknown>) => void): () => void;
  getOperationalState?(): Record<string, unknown>;
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
}

export interface DeviceSummary {
  id: string;
  deviceClass: DeviceClass;
  moduleId: string;
  lifecycle: DeviceLifecycleStatus;
  simulated: boolean;
  vendor?: string;
  model?: string;
  label?: string;
}
