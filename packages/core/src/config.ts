import { ValidationError } from './errors.js';
import type { LogLevel } from './logger.js';

export interface PinoutEnvConfig {
  port?: string;
  baudRate: number;
  timeoutMs: number;
  logLevel: LogLevel;
}

const defaultBaudRate = 115200;
const defaultTimeoutMs = 5000;
const defaultLogLevel: LogLevel = 'info';
const logLevels: LogLevel[] = ['debug', 'info', 'warn', 'error'];

export function loadPinoutConfig(env: NodeJS.ProcessEnv = process.env): PinoutEnvConfig {
  const port = readOptionalString(env.PINOUT_PORT);
  const config: PinoutEnvConfig = {
    baudRate: readPositiveInt(env.PINOUT_BAUD, defaultBaudRate, 'PINOUT_BAUD'),
    timeoutMs: readPositiveInt(env.PINOUT_TIMEOUT, defaultTimeoutMs, 'PINOUT_TIMEOUT'),
    logLevel: readLogLevel(env.PINOUT_LOG_LEVEL, defaultLogLevel),
  };
  if (port !== undefined) {
    config.port = port;
  }
  return config;
}

function readOptionalString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function readPositiveInt(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined || value.trim().length === 0) {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new ValidationError(`${name} must be a positive integer, received '${value}'.`);
  }
  return parsed;
}

function readLogLevel(value: string | undefined, fallback: LogLevel): LogLevel {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) {
    return fallback;
  }
  if (!logLevels.includes(normalized as LogLevel)) {
    throw new ValidationError(
      `PINOUT_LOG_LEVEL must be one of ${logLevels.join(', ')}, received '${value}'.`,
    );
  }
  return normalized as LogLevel;
}
