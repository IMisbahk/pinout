import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { Device, AgentTool } from '@pinout/core';

export function createPinoutMcpServer(device: Device): Server {
  const tools = device.toAgentTools();
  const toolByName = new Map(tools.map((tool) => [tool.name, tool]));

  const server = new Server(
    { name: 'pinout', version: device.info.version },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map(toMcpTool),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const tool = toolByName.get(request.params.name);
    if (!tool) {
      return {
        isError: true,
        content: [{ type: 'text', text: `Unknown tool '${request.params.name}'.` }],
      };
    }

    const args = (request.params.arguments ?? {}) as Record<string, unknown>;
    try {
      const result = await device.invoke(tool.name, args);
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    } catch (error) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: error instanceof Error ? error.message : String(error),
          },
        ],
      };
    }
  });

  return server;
}

function toMcpTool(tool: AgentTool) {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: {
      type: 'object' as const,
      ...tool.inputSchema,
    },
    outputSchema: {
      type: 'object' as const,
      ...tool.outputSchema,
    },
    annotations: {
      readOnlyHint: !tool.annotations.physicalOutput,
      // Physical outputs always receive the conservative destructive hint.
      // Reversible actions such as toggle are still neither harmless nor idempotent.
      destructiveHint: tool.annotations.physicalOutput,
      ...(tool.annotations.physicalOutput ? {} : { idempotentHint: true }),
      title: tool.name,
    },
  };
}
