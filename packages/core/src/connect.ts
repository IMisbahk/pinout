import { Device } from './device.js';
import { Session } from './session.js';
import type { ConnectOptions } from './types.js';

const defaultTimeoutMs = 5000;

export async function connect(options: ConnectOptions): Promise<Device> {
  const session = new Session(options.transport, options.timeoutMs ?? defaultTimeoutMs);
  const info = await session.connect();
  return new Device(info, session);
}
