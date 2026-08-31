import { loadPinoutConfig } from './config.js';
import { Device } from './device.js';
import { createLogger } from './logger.js';
import { Session } from './session.js';
import type { ConnectOptions } from './types.js';

export async function connect(options: ConnectOptions): Promise<Device> {
  const config = loadPinoutConfig();
  const logger = createLogger(config.logLevel);
  const session = new Session(
    options.transport,
    options.timeoutMs ?? config.timeoutMs,
    options.signal,
    logger,
  );
  const info = await session.connect();
  return new Device(info, session);
}
