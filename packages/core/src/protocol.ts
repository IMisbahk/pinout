import { ProtocolError } from './errors.js';
import type { DeviceInfo } from './types.js';

export const protocolVersion = 1;

export interface ProtocolRequest {
  v: number;
  id: string;
  action: string;
  payload: Record<string, unknown>;
}

export interface ProtocolSuccess {
  v: number;
  id: string;
  ok: true;
  result: Record<string, unknown>;
}

export interface ProtocolFailure {
  v: number;
  id: string;
  ok: false;
  error: {
    code: string;
    message: string;
  };
}

export type ProtocolResponse = ProtocolSuccess | ProtocolFailure;

export interface ProtocolEvent {
  v: number;
  event: string;
  payload: Record<string, unknown>;
}

export type ProtocolMessage = ProtocolRequest | ProtocolResponse | ProtocolEvent;

export function encodeRequest(
  id: string,
  action: string,
  payload: Record<string, unknown> = {},
): string {
  const request: ProtocolRequest = {
    v: protocolVersion,
    id,
    action,
    payload,
  };
  return `${JSON.stringify(request)}\n`;
}

export function parseLine(line: string): ProtocolMessage | null {
  const trimmed = line.replace(/\r$/, '').trim();
  if (!trimmed.startsWith('{')) {
    return null;
  }

  let value: unknown;
  try {
    value = JSON.parse(trimmed);
  } catch {
    throw new ProtocolError(`Device sent invalid JSON: ${trimmed}`);
  }

  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ProtocolError('Device sent a JSON value that is not an object.');
  }

  const record = value as Record<string, unknown>;
  if (record.v !== protocolVersion) {
    throw new ProtocolError(
      `Unsupported protocol version '${String(record.v)}'. This SDK speaks v${protocolVersion}.`,
    );
  }

  if (typeof record.event === 'string') {
    return {
      v: protocolVersion,
      event: record.event,
      payload: isPlainObject(record.payload) ? record.payload : {},
    };
  }

  if (typeof record.id !== 'string' || record.id.length === 0) {
    throw new ProtocolError('Protocol message is missing a string id.');
  }

  if (typeof record.action === 'string') {
    return {
      v: protocolVersion,
      id: record.id,
      action: record.action,
      payload: isPlainObject(record.payload) ? record.payload : {},
    };
  }

  if (record.ok === true) {
    return {
      v: protocolVersion,
      id: record.id,
      ok: true,
      result: isPlainObject(record.result) ? record.result : {},
    };
  }

  if (record.ok === false) {
    const error = record.error;
    if (
      !isPlainObject(error) ||
      typeof error.code !== 'string' ||
      typeof error.message !== 'string'
    ) {
      throw new ProtocolError('Error response is missing error.code and error.message.');
    }
    return {
      v: protocolVersion,
      id: record.id,
      ok: false,
      error: { code: error.code, message: error.message },
    };
  }

  throw new ProtocolError(`Unrecognized protocol message: ${trimmed}`);
}

export function parseDeviceInfo(payload: Record<string, unknown>): DeviceInfo {
  const firmware = payload.firmware;
  const version = payload.version;
  const protocol = payload.protocol;
  const capabilities = payload.capabilities;

  if (typeof firmware !== 'string' || firmware.length === 0) {
    throw new ProtocolError('Device identity is missing firmware.');
  }
  if (typeof version !== 'string') {
    throw new ProtocolError('Device identity is missing version.');
  }
  if (protocol !== protocolVersion) {
    throw new ProtocolError(
      `Device protocol '${String(protocol)}' is not supported. Expected ${protocolVersion}.`,
    );
  }
  if (!Array.isArray(capabilities) || !capabilities.every((item) => typeof item === 'string')) {
    throw new ProtocolError('Device identity is missing a capabilities string array.');
  }

  return { firmware, version, protocol, capabilities };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
