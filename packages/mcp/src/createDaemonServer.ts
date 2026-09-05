import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import {
  buildMcpToolName,
  PINOUT_VERSION,
  type CapabilityDescriptor,
  type RuntimeAgentTool,
} from '@pinout/core';
import { controlPlaneTools, formatToolError, success, toMcpTool } from './createRuntimeServer.js';

export interface DaemonMcpServerOptions {
  baseUrl?: string;
  token?: string;
  owner?: string;
  fetch?: typeof globalThis.fetch;
}

interface DaemonDeviceSummary {
  id: string;
}

interface DaemonDeviceDescription {
  capabilityDescriptors: CapabilityDescriptor[];
  [key: string]: unknown;
}

/** MCP client for the single authoritative pinoutd process. */
export function createDaemonMcpServer(options: DaemonMcpServerOptions = {}): Server {
  const client = new DaemonClient(options);
  const server = new Server(
    { name: 'pinout-daemon', version: PINOUT_VERSION },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    let runtimeToolsList: RuntimeAgentTool[] = [];
    try {
      runtimeToolsList = await client.runtimeTools();
    } catch {
      runtimeToolsList = [];
    }
    return {
      tools: [...controlPlaneTools(), ...runtimeToolsList.map(toMcpTool)],
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const args = (request.params.arguments ?? {}) as Record<string, unknown>;
    try {
      switch (request.params.name) {
        case 'pinout__list_devices':
          return success(await client.call('GET', '/v1/devices'));
        case 'pinout__describe_device': {
          const raw = await client.call(
            'GET',
            `/v1/devices/${segment(required(args, 'deviceId'))}`,
          );
          const rawHealth =
            raw.health && typeof raw.health === 'object'
              ? (raw.health as Record<string, unknown>)
              : { lifecycle: raw.lifecycle ?? 'ready', healthy: true };
          const rawIdentity =
            raw.identity && typeof raw.identity === 'object'
              ? (raw.identity as Record<string, unknown>)
              : { id: raw.id, moduleId: raw.moduleId, deviceClass: raw.deviceClass };
          const rawSupportedTransports = Array.isArray(raw.supportedTransportKinds)
            ? (raw.supportedTransportKinds as string[])
            : typeof raw.activeTransportKind === 'string'
              ? [raw.activeTransportKind]
              : ['simulated'];
          const capabilityDescriptors = Array.isArray(raw.capabilityDescriptors)
            ? raw.capabilityDescriptors
            : [];
          return success({
            identity: rawIdentity,
            health: rawHealth,
            simulated: Boolean(raw.simulated),
            activeTransportKind: (raw.activeTransportKind as string) ?? 'simulated',
            supportedTransportKinds: rawSupportedTransports,
            capabilities: capabilityDescriptors,
            operationalState: (raw.operationalState as Record<string, unknown>) ?? {},
          });
        }
        case 'pinout__read_state':
          return success(
            await client.call('GET', `/v1/devices/${segment(required(args, 'deviceId'))}/state`),
          );
        case 'pinout__safety_status':
          return success(await client.call('GET', '/v1/safety'));
        case 'pinout__acquire_lease':
          return success(
            await client.call('POST', '/v1/leases', {
              owner: client.ownerFor(args),
              mode: args.mode ?? 'exclusive',
              ...(typeof args.ttlMs === 'number' ? { ttlMs: args.ttlMs } : {}),
              scope: { kind: 'device', deviceId: required(args, 'deviceId') },
            }),
          );
        case 'pinout__release_lease': {
          const owner = client.ownerFor(args);
          return success(
            await client.call(
              'DELETE',
              `/v1/leases/${segment(required(args, 'leaseId'))}?owner=${encodeURIComponent(owner)}`,
              { owner },
            ),
          );
        }
        case 'pinout__dry_run':
          return success(
            await client.call('POST', `/v1/devices/${segment(required(args, 'deviceId'))}/invoke`, {
              capability: required(args, 'capability'),
              args: objectArg(args.args),
              owner: client.ownerFor(args),
              dryRun: true,
            }),
          );
        case 'pinout__operation_status':
          return success(
            await client.call('GET', `/v1/operations/${segment(required(args, 'operationId'))}`),
          );
        case 'pinout__cancel_operation':
          return success(
            await client.call(
              'POST',
              `/v1/operations/${segment(required(args, 'operationId'))}/cancel`,
              typeof args.reason === 'string' ? { reason: args.reason } : {},
            ),
          );
      }

      const tool = (await client.runtimeTools()).find(
        (candidate) => candidate.mcpName === request.params.name,
      );
      if (!tool) throw structured('UNKNOWN_TOOL', `Unknown tool '${request.params.name}'.`);
      const control = objectArg(args._pinout);
      const capabilityArgs = { ...args };
      delete capabilityArgs._pinout;
      return success(
        await client.call('POST', `/v1/devices/${segment(tool.deviceId)}/invoke`, {
          capability: tool.capability,
          args: capabilityArgs,
          owner: client.ownerFor(control),
          waitFor: control.waitFor === 'accepted' ? 'accepted' : 'result',
          ...(typeof control.idempotencyKey === 'string'
            ? { idempotencyKey: control.idempotencyKey }
            : {}),
          ...(typeof control.timeoutMs === 'number' ? { timeoutMs: control.timeoutMs } : {}),
        }),
      );
    } catch (error) {
      return formatToolError(error);
    }
  });

  return server;
}

class DaemonClient {
  private readonly baseUrl: string;
  private readonly token: string | undefined;
  private readonly fetchFn: typeof globalThis.fetch;
  readonly owner: string;

  constructor(options: DaemonMcpServerOptions) {
    this.baseUrl = (options.baseUrl ?? 'http://127.0.0.1:8787').replace(/\/$/, '');
    this.token = options.token;
    this.owner = options.owner ?? 'mcp-stdio';
    this.fetchFn = options.fetch ?? globalThis.fetch;
  }

  ownerFor(_args: Record<string, unknown>): string {
    return this.owner;
  }

  async call(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    body?: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const headers: Record<string, string> = {};
    if (this.token) headers.authorization = `Bearer ${this.token}`;
    if (body !== undefined) headers['content-type'] = 'application/json';
    let response: Response;
    try {
      response = await this.fetchFn(`${this.baseUrl}${path}`, {
        method,
        headers,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
    } catch (networkError) {
      throw structured(
        'DAEMON_UNAVAILABLE',
        `Unable to reach pinoutd daemon at ${this.baseUrl}: ${networkError instanceof Error ? networkError.message : String(networkError)}. Ensure pinoutd is running and PINOUT_DAEMON_URL is configured correctly.`,
      );
    }
    let payload: Record<string, unknown>;
    try {
      payload = (await response.json()) as Record<string, unknown>;
    } catch {
      payload = {};
    }
    if (!response.ok) {
      const error = objectArg(payload.error);
      throw structured(
        typeof error.code === 'string' ? error.code : 'DAEMON_REQUEST_FAILED',
        typeof error.message === 'string'
          ? error.message
          : `pinoutd returned HTTP ${response.status}.`,
        error,
      );
    }
    return payload;
  }

  async runtimeTools(): Promise<RuntimeAgentTool[]> {
    const list = await this.call('GET', '/v1/devices');
    const devices = Array.isArray(list.devices) ? (list.devices as DaemonDeviceSummary[]) : [];
    const descriptions = await Promise.all(
      devices.map(async (device) => ({
        device,
        description: (await this.call(
          'GET',
          `/v1/devices/${segment(device.id)}`,
        )) as DaemonDeviceDescription,
      })),
    );
    return descriptions.flatMap(({ device, description }) =>
      description.capabilityDescriptors.map((capability) => toRuntimeTool(device.id, capability)),
    );
  }
}

function toRuntimeTool(deviceId: string, capability: CapabilityDescriptor): RuntimeAgentTool {
  return {
    name: capability.name,
    mcpName: buildMcpToolName(deviceId, capability.name),
    deviceId,
    capability: capability.name,
    description: `[${deviceId}] ${capability.description}`,
    inputSchema: capability.inputSchema,
    outputSchema: capability.outputSchema,
    annotations: {
      physicalOutput: capability.safety.physicalOutput,
      reversible: capability.safety.reversible,
      ...(capability.safety.notes ? { notes: capability.safety.notes } : {}),
    },
  };
}

function required(args: Record<string, unknown>, name: string): string {
  const value = args[name];
  if (typeof value !== 'string' || value.length === 0) {
    throw structured('VALIDATION_ERROR', `${name} must be a non-empty string.`);
  }
  return value;
}

function objectArg(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function segment(value: string): string {
  return encodeURIComponent(value);
}

function structured(code: string, message: string, details?: Record<string, unknown>) {
  return { code, message, retryable: false, ...(details ? { metadata: details } : {}) };
}
