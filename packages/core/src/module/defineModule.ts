import type { PolicyRule } from '../policy/types.js';
import type { CapabilityDescriptor } from '../types.js';
import type { DeviceBackend, PinoutModuleDefinition } from '../runtime/types.js';
import type { DeclarativePolicyMap } from './policies.js';
import { policiesFromDeclarative } from './policies.js';
import { validateModuleInput } from './validate.js';

export interface ModuleDeviceMetadata {
  class: string;
  vendor?: string;
  model?: string;
  name?: string;
  description?: string;
}

export interface DefineModuleInput {
  id: string;
  version: string;
  device: ModuleDeviceMetadata;
  capabilities: CapabilityDescriptor[];
  policies?: PolicyRule[] | DeclarativePolicyMap;
  supportedTransportKinds?: string[];
  createBackend: (config: Record<string, unknown>) => DeviceBackend | Promise<DeviceBackend>;
}

function resolvePolicies(policies: PolicyRule[] | DeclarativePolicyMap | undefined): PolicyRule[] {
  if (!policies) {
    return [];
  }
  if (Array.isArray(policies)) {
    return policies;
  }
  return policiesFromDeclarative(policies);
}

async function normalizeBackend(
  backend: DeviceBackend | Promise<DeviceBackend>,
): Promise<DeviceBackend> {
  return await backend;
}

/**
 * Define a Pinout module for third-party hardware support.
 * Validates metadata and produces a runtime-ready module definition.
 */
export function defineModule(input: DefineModuleInput): PinoutModuleDefinition {
  validateModuleInput(input);
  const policyRules = resolvePolicies(input.policies);
  const capabilityNames = input.capabilities.map((capability) => capability.name);
  const transportKinds = input.supportedTransportKinds ?? ['simulated'];

  const module: PinoutModuleDefinition = {
    id: input.id,
    version: input.version,
    deviceClass: input.device.class,
    capabilities: input.capabilities,
    capabilityNames,
    policies: policyRules,
    supportedTransportKinds: transportKinds,
    createSimulatedBackend(options: Record<string, unknown> = {}) {
      const backend = input.createBackend({ ...options, simulated: true });
      if (backend instanceof Promise) {
        throw new Error('createBackend must return synchronously for simulated backends.');
      }
      return backend;
    },
    async createProtocolBackend(options: Record<string, unknown>) {
      return normalizeBackend(input.createBackend({ ...options, simulated: false }));
    },
  };
  if (input.device.vendor !== undefined) {
    module.vendor = input.device.vendor;
  }
  if (input.device.model !== undefined) {
    module.model = input.device.model;
  }
  return module;
}
