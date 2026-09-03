/**
 * Module IPC wire protocol (spec v1).
 *
 * One JSON object per line over the worker's stdio. Requests correlate with
 * responses by `id`. Heartbeats are worker-initiated and uncorrelated.
 *
 * IMPORTANT HONESTY NOTE: this protocol provides PROCESS ISOLATION (a crashed
 * worker cannot crash the runtime), not a security sandbox. A malicious
 * worker process can still access the OS with its own privileges. Declared
 * permissions (network, serial, filesystem, …) are review metadata, not
 * enforcement. See README.md for the exact boundary.
 */

export const MODULE_IPC_VERSION = 1;

/** Host → worker. */
export interface ModuleIpcInit {
  v: typeof MODULE_IPC_VERSION;
  id: string;
  kind: 'init';
  payload: {
    moduleId: string;
    modulePath?: string;
    config?: Record<string, unknown>;
    /** Milliseconds between worker heartbeats (informational for the worker). */
    heartbeatIntervalMs?: number;
  };
}

export interface ModuleIpcInvoke {
  v: typeof MODULE_IPC_VERSION;
  id: string;
  kind: 'invoke';
  payload: {
    capability: string;
    args: Record<string, unknown>;
  };
}

export interface ModuleIpcShutdown {
  v: typeof MODULE_IPC_VERSION;
  id: string;
  kind: 'shutdown';
  payload: Record<string, never>;
}

export type ModuleIpcRequest = ModuleIpcInit | ModuleIpcInvoke | ModuleIpcShutdown;

/** Worker → host. */
export interface ModuleIpcReady {
  v: typeof MODULE_IPC_VERSION;
  id: string;
  kind: 'ready';
  payload: { capabilities: string[] };
}

export interface ModuleIpcResult {
  v: typeof MODULE_IPC_VERSION;
  id: string;
  kind: 'result';
  payload: { result: Record<string, unknown> };
}

export interface ModuleIpcError {
  v: typeof MODULE_IPC_VERSION;
  id: string;
  kind: 'error';
  payload: {
    code: string;
    category: string;
    message: string;
    retryable?: boolean;
    details?: Record<string, unknown>;
  };
}

export interface ModuleIpcEvent {
  v: typeof MODULE_IPC_VERSION;
  kind: 'event';
  id?: string;
  payload: { event: string; data: Record<string, unknown> };
}

export interface ModuleIpcHeartbeat {
  v: typeof MODULE_IPC_VERSION;
  kind: 'heartbeat';
  payload: { at: number };
}

export type ModuleIpcResponse =
  ModuleIpcReady | ModuleIpcResult | ModuleIpcError | ModuleIpcEvent | ModuleIpcHeartbeat;

export type ModuleIpcMessage = ModuleIpcRequest | ModuleIpcResponse;

export function encodeMessage(message: ModuleIpcMessage): string {
  return `${JSON.stringify(message)}\n`;
}

export interface DecodedMessage {
  message?: ModuleIpcMessage;
  /** Non-JSON or malformed lines are dropped, not fatal (partial writes). */
  invalid?: boolean;
}

export function decodeMessage(line: string): DecodedMessage {
  const trimmed = line.trim();
  if (trimmed.length === 0 || !trimmed.startsWith('{')) return { invalid: true };
  try {
    const parsed = JSON.parse(trimmed) as { v?: number; kind?: string };
    if (parsed.v !== MODULE_IPC_VERSION || typeof parsed.kind !== 'string') {
      return { invalid: true };
    }
    return { message: parsed as ModuleIpcMessage };
  } catch {
    return { invalid: true };
  }
}
