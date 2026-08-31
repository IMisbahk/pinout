import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { PinoutRuntime } from '@pinout/core';
import { runtimeToAgentTools, type RuntimeAgentTool } from '@pinout/core';

export function createRuntimeMcpServer(runtime: PinoutRuntime): Server {
  const tools = runtimeToAgentTools(runtime);
  const toolByName = new Map(tools.map((tool) => [tool.mcpName, tool]));

  const server = new Server(
    { name: 'pinout-runtime', version: '0.2.0' },
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
      const result = await runtime.invoke(tool.deviceId, tool.capability, args);
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    } catch (error) {
      return formatToolError(error);
    }
  });

  return server;
}

export function createPinoutMcpServerFromRuntime(runtime: PinoutRuntime): Server {
  return createRuntimeMcpServer(runtime);
}

function toMcpTool(tool: RuntimeAgentTool) {
  return {
    name: tool.mcpName,
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
      destructiveHint: tool.annotations.physicalOutput,
      idempotentHint: tool.annotations.reversible,
      title: tool.mcpName,
    },
  };
}

function formatToolError(error: unknown) {
  if (error && typeof error === 'object' && 'code' in error && 'message' in error) {
    const record = error as { code: string; message: string; metadata?: Record<string, unknown> };
    return {
      isError: true,
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              code: record.code,
              message: record.message,
              metadata: 'metadata' in record ? record.metadata : undefined,
            },
            null,
            2,
          ),
        },
      ],
    };
  }
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
