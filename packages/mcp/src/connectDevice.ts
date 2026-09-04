import { connect, simulatedEsp32 } from '@pinout/core';
import type { Device } from '@pinout/core';
import type { Transport } from '@pinout/core';

export interface PinoutMcpConnectOptions {
  mock?: boolean;
  port?: string;
  baudRate?: number;
  timeoutMs?: number;
}

const defaultTimeoutMs = 5000;
const defaultBaudRate = 115200;

export async function connectPinoutDevice(options: PinoutMcpConnectOptions = {}): Promise<Device> {
  return connect({
    transport: await createMcpTransport(options),
    timeoutMs: options.timeoutMs ?? readPositiveInt(process.env.PINOUT_TIMEOUT, defaultTimeoutMs),
  });
}

/** Resolve the MCP bridge transport without connecting outside the runtime. */
export async function createMcpTransport(
  options: PinoutMcpConnectOptions = {},
): Promise<Transport> {
  const mock = options.mock ?? process.env.PINOUT_MOCK === '1';
  const port = options.port ?? process.env.PINOUT_PORT;
  const baudRate = options.baudRate ?? readPositiveInt(process.env.PINOUT_BAUD, defaultBaudRate);
  const timeoutMs =
    options.timeoutMs ?? readPositiveInt(process.env.PINOUT_TIMEOUT, defaultTimeoutMs);

  if (mock && port) {
    throw new Error('Use either mock mode or a serial port, not both.');
  }
  if (!mock && !port) {
    throw new Error(
      'Set PINOUT_PORT for hardware or PINOUT_MOCK=1 (or pass mock: true) for the simulator.',
    );
  }

  if (mock) {
    return simulatedEsp32();
  }

  const { serialPort } = await import('@pinout/core/serial');
  return serialPort({ path: port as string, baudRate });
}

function readPositiveInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === '') {
    return fallback;
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Expected a positive integer, got '${raw}'.`);
  }
  return parsed;
}
