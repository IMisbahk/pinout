/**
 * Inspect MCP tools generated from a heterogeneous Pinout runtime (no LLM required).
 *
 *   npm run example:mcp-heterogeneous
 */
import { createHeterogeneousRuntime, runtimeToAgentTools } from '@pinout/core';

const runtime = await createHeterogeneousRuntime({ motionDelayMs: 0 });
const tools = runtimeToAgentTools(runtime);

console.log('Devices:');
for (const device of runtime.devices()) {
  console.log(`  ${device.id} (${device.deviceClass})`);
}

console.log('\nMCP tools:');
for (const tool of tools) {
  console.log(`  ${tool.mcpName}`);
  console.log(`    capability: ${tool.capability}`);
  console.log(`    device:     ${tool.deviceId}`);
}

console.log(`\nTotal tools: ${tools.length}`);
await runtime.close();
