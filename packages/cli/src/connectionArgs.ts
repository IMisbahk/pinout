import { InvalidArgumentError, type Command } from 'commander';
import { connect, simulatedEsp32 } from '@pinout/core';
import type { Device } from '@pinout/core';

export interface ConnectionOptions {
  mock: boolean;
  port?: string;
  baud: number;
  timeout: number;
}

export interface ConnectionFlags {
  port?: string;
  mock?: boolean;
  baud?: number;
  timeout?: number;
}

const defaultBaud = readEnvInt('PINOUT_BAUD', 115200);
const defaultTimeout = readEnvInt('PINOUT_TIMEOUT', 5000);

export function addConnectionOptions(command: Command): Command {
  return command
    .option('-p, --port <path>', 'serial port path (defaults to PINOUT_PORT when set)')
    .option('--mock', 'use the simulated ESP32 instead of hardware', false)
    .option('--baud <rate>', 'serial baud rate', parsePositiveInt, defaultBaud)
    .option('--timeout <ms>', 'request timeout in milliseconds', parsePositiveInt, defaultTimeout);
}

export function resolveConnectionOptions(flags: ConnectionFlags): ConnectionOptions {
  const port = flags.port ?? process.env.PINOUT_PORT;
  const mock = flags.mock ?? false;

  if (mock && port) {
    throw new Error('Use either --mock or --port, not both.');
  }
  if (!mock && !port) {
    throw new Error(
      'Provide --port <path> for hardware, set PINOUT_PORT, or use --mock for the simulator.',
    );
  }

  const resolved: ConnectionOptions = {
    mock,
    baud: flags.baud ?? defaultBaud,
    timeout: flags.timeout ?? defaultTimeout,
  };
  if (port !== undefined) {
    resolved.port = port;
  }
  return resolved;
}

export async function openDevice(options: ConnectionOptions): Promise<Device> {
  if (options.mock) {
    return connect({ transport: simulatedEsp32(), timeoutMs: options.timeout });
  }

  const { serialPort } = await import('@pinout/core/serial');
  return connect({
    transport: serialPort({ path: options.port as string, baudRate: options.baud }),
    timeoutMs: options.timeout,
  });
}

export function parsePin(value: string): number {
  const pin = Number(value);
  if (!Number.isInteger(pin) || pin < 0) {
    throw new InvalidArgumentError('Pin must be a non-negative integer.');
  }
  return pin;
}

export function parseLevel(value: string): boolean {
  const normalized = value.toLowerCase();
  if (['high', 'true', '1', 'on'].includes(normalized)) {
    return true;
  }
  if (['low', 'false', '0', 'off'].includes(normalized)) {
    return false;
  }
  throw new InvalidArgumentError('Value must be high, low, true, false, 1, or 0.');
}

export function parsePositiveInt(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new InvalidArgumentError('Expected a positive integer.');
  }
  return parsed;
}

export function parseJsonObject(value: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new InvalidArgumentError('Payload must be valid JSON.');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new InvalidArgumentError('Payload must be a JSON object.');
  }
  return parsed as Record<string, unknown>;
}

export function parseGpioMode(value: string): string {
  const normalized = value.toLowerCase();
  const allowed = ['input', 'output', 'pullup', 'pulldown'];
  if (!allowed.includes(normalized)) {
    throw new InvalidArgumentError(`Mode must be one of: ${allowed.join(', ')}.`);
  }
  return normalized;
}

function readEnvInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}
