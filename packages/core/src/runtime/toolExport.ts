/**
 * Protocol-independent tool export (spec v1).
 *
 * `runtimeToToolDefinitions` produces a vendor-neutral description of every
 * device capability so adapter layers (MCP, OpenAI-style functions,
 * Anthropic-style tools, future agent protocols) can transform them without
 * Pinout Core knowing anything about any AI vendor.
 */
import type { AgentTool, CapabilitySafety, JsonSchema } from '../types.js';
import type { DeviceInstance } from './deviceInstance.js';
import type { PinoutRuntime } from './runtime.js';

/**
 * Descriptive risk classification derived from capability safety metadata.
 * This is informational for downstream permission systems; enforcement is
 * always the policy engine's job.
 */
export type ToolDanger = 'READ_ONLY' | 'LOW_RISK' | 'PHYSICAL_SIDE_EFFECT' | 'HIGH_RISK';

export interface ToolDefinition {
  /** `deviceId.capability` — globally unique within a runtime. */
  name: string;
  description: string;
  inputSchema: JsonSchema;
  outputSchema: JsonSchema;
  danger: ToolDanger;
  safety: CapabilitySafety;
  deviceId: string;
  capability: string;
}

export function classifyToolDanger(safety: CapabilitySafety): ToolDanger {
  if (safety.physicalOutput && !safety.reversible) return 'HIGH_RISK';
  if (safety.physicalOutput) return 'PHYSICAL_SIDE_EFFECT';
  return 'READ_ONLY';
}

function fromDevice(device: DeviceInstance): ToolDefinition[] {
  const tools: ToolDefinition[] = [];
  for (const capability of device.capabilities) {
    const agentTool: AgentTool = {
      name: capability.name,
      description: capability.description,
      inputSchema: capability.inputSchema,
      outputSchema: capability.outputSchema,
      annotations: capability.safety,
    };
    tools.push({
      name: `${device.id}.${capability.name}`,
      description: `[${device.id}] ${capability.description}`,
      inputSchema: agentTool.inputSchema,
      outputSchema: agentTool.outputSchema,
      danger: classifyToolDanger(capability.safety),
      safety: capability.safety,
      deviceId: device.id,
      capability: capability.name,
    });
  }
  return tools;
}

/** Export every capability of every device as a protocol-neutral tool definition. */
export function runtimeToToolDefinitions(runtime: PinoutRuntime): ToolDefinition[] {
  const out: ToolDefinition[] = [];
  for (const summary of runtime.devices()) {
    out.push(...fromDevice(runtime.getDevice(summary.id)));
  }
  return out;
}
