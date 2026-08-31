import { toAgentTools } from '../capabilities.js';
import type { AgentTool, CapabilityDescriptor } from '../types.js';
import type { DeviceInstance } from './deviceInstance.js';
import type { PinoutRuntime } from './runtime.js';

export interface RuntimeAgentTool extends AgentTool {
  deviceId: string;
  capability: string;
  mcpName: string;
}

export function runtimeToAgentTools(runtime: PinoutRuntime): RuntimeAgentTool[] {
  const tools: RuntimeAgentTool[] = [];
  for (const summary of runtime.devices()) {
    const device = runtime.getDevice(summary.id);
    tools.push(...deviceToRuntimeAgentTools(device));
  }
  return tools;
}

export function deviceToRuntimeAgentTools(device: DeviceInstance): RuntimeAgentTool[] {
  return device.capabilities.map((capability) => toRuntimeAgentTool(device.id, capability));
}

export function toRuntimeAgentTool(
  deviceId: string,
  capability: CapabilityDescriptor,
): RuntimeAgentTool {
  const [base] = toAgentTools([capability]);
  const mcpName = buildMcpToolName(deviceId, capability.name);
  return {
    ...base!,
    name: capability.name,
    deviceId,
    capability: capability.name,
    mcpName,
    description: `[${deviceId}] ${capability.description}`,
  };
}

export function buildMcpToolName(deviceId: string, capability: string): string {
  const normalizedId = deviceId.replace(/-/g, '_');
  const normalizedCapability = capability.replace(/\./g, '_');
  return `${normalizedId}__${normalizedCapability}`;
}

export function parseMcpToolName(mcpName: string): { deviceId: string; capability: string } | null {
  const separator = mcpName.indexOf('__');
  if (separator <= 0) {
    return null;
  }
  const rawId = mcpName.slice(0, separator).replace(/_/g, '-');
  const rawCapability = mcpName.slice(separator + 2).replace(/_/g, '.');
  return { deviceId: rawId, capability: rawCapability };
}
