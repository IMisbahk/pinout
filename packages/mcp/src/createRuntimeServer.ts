import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { PinoutRuntime } from '@pinout/core';
import { runtimeToAgentTools, type RuntimeAgentTool } from '@pinout/core';

const listDevicesToolName = 'pinout__list_devices';
const describeDeviceToolName = 'pinout__describe_device';

export interface RuntimeMcpServerOptions {
  /** Principal associated with this MCP transport for lease-aware policies. */
  owner?: string;
}

export function createRuntimeMcpServer(
  runtime: PinoutRuntime,
  options: RuntimeMcpServerOptions = {},
): Server {
  const server = new Server(
    { name: 'pinout-runtime', version: '0.2.0' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [...controlPlaneTools(), ...runtimeTools(runtime).map(toMcpTool)],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    if (request.params.name === listDevicesToolName) {
      return success({ devices: runtime.devices() });
    }

    if (request.params.name === describeDeviceToolName) {
      const args = (request.params.arguments ?? {}) as Record<string, unknown>;
      if (typeof args.deviceId !== 'string' || args.deviceId.length === 0) {
        return formatToolError(new Error('deviceId must be a non-empty string.'));
      }
      try {
        const device = runtime.getDevice(args.deviceId);
        return success({
          identity: device.identity,
          health: device.getHealth(),
          simulated: device.simulated,
          activeTransportKind: device.activeTransportKind,
          supportedTransportKinds: device.transportKinds,
          capabilities: device.capabilities,
          operationalState: device.getOperationalStateSnapshot(),
        });
      } catch (error) {
        return formatToolError(error);
      }
    }

    // Resolve on every call so devices registered after server creation are visible.
    const tools = runtimeTools(runtime);
    const toolByName = new Map(tools.map((tool) => [tool.mcpName, tool]));
    const tool = toolByName.get(request.params.name);
    if (!tool) {
      return {
        isError: true,
        content: [{ type: 'text', text: `Unknown tool '${request.params.name}'.` }],
      };
    }

    const args = (request.params.arguments ?? {}) as Record<string, unknown>;
    try {
      const result = await runtime.invoke(tool.deviceId, tool.capability, args, {
        owner: options.owner ?? 'mcp-stdio',
      });
      return success(result);
    } catch (error) {
      return formatToolError(error);
    }
  });

  return server;
}

function controlPlaneTools() {
  return [
    {
      name: listDevicesToolName,
      description: 'List every device currently registered in the Pinout runtime.',
      inputSchema: { type: 'object' as const, additionalProperties: false, properties: {} },
      outputSchema: {
        type: 'object' as const,
        required: ['devices'],
        properties: { devices: { type: 'array', items: { type: 'object' } } },
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        title: 'List Pinout devices',
      },
    },
    {
      name: describeDeviceToolName,
      description:
        'Inspect one Pinout device, including identity, health, capabilities, transport, and current operational state.',
      inputSchema: {
        type: 'object' as const,
        additionalProperties: false,
        required: ['deviceId'],
        properties: { deviceId: { type: 'string', minLength: 1 } },
      },
      outputSchema: {
        type: 'object' as const,
        required: [
          'identity',
          'health',
          'simulated',
          'activeTransportKind',
          'supportedTransportKinds',
          'capabilities',
          'operationalState',
        ],
        properties: {
          identity: { type: 'object' },
          health: { type: 'object' },
          simulated: { type: 'boolean' },
          activeTransportKind: { type: 'string' },
          supportedTransportKinds: { type: 'array', items: { type: 'string' } },
          capabilities: { type: 'array', items: { type: 'object' } },
          operationalState: { type: 'object' },
        },
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        title: 'Describe Pinout device',
      },
    },
  ];
}

function runtimeTools(runtime: PinoutRuntime): RuntimeAgentTool[] {
  const tools = runtimeToAgentTools(runtime);
  const reserved = new Set([listDevicesToolName, describeDeviceToolName]);
  const conflict = tools.find((tool) => reserved.has(tool.mcpName));
  if (conflict) {
    throw new Error(
      `Runtime tool '${conflict.mcpName}' conflicts with a reserved Pinout control-plane tool.`,
    );
  }
  return tools;
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
      // Treat every physical output as destructive for conservative agent confirmation.
      // Reversible does not imply harmless or idempotent in the physical world.
      destructiveHint: tool.annotations.physicalOutput,
      ...(tool.annotations.physicalOutput ? {} : { idempotentHint: true }),
      title: tool.mcpName,
    },
  };
}

function success(result: Record<string, unknown>) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
    structuredContent: result,
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
