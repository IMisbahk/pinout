import { PinoutError } from '../errors.js';

export class ModuleNotFoundError extends PinoutError {
  constructor(moduleId: string) {
    super('MODULE_NOT_FOUND', `Pinout module '${moduleId}' is not installed.`);
  }
}

export class ModuleAlreadyInstalledError extends PinoutError {
  constructor(moduleId: string) {
    super('MODULE_ALREADY_INSTALLED', `Pinout module '${moduleId}' is already installed.`);
  }
}

export class ModuleInvalidError extends PinoutError {
  readonly details: unknown;

  constructor(message: string, details?: unknown) {
    super('MODULE_INVALID', message);
    this.details = details;
  }
}

export class ModuleIncompatibleError extends PinoutError {
  constructor(moduleId: string, minimumVersion: string, currentVersion: string) {
    super(
      'MODULE_INCOMPATIBLE',
      `Module '${moduleId}' requires Pinout >= ${minimumVersion}, current ${currentVersion}.`,
    );
  }
}

export class ModuleLoadFailedError extends PinoutError {
  override readonly cause: unknown;

  constructor(moduleId: string, cause: unknown) {
    const message =
      cause instanceof Error
        ? `Failed to load module '${moduleId}': ${cause.message}`
        : `Failed to load module '${moduleId}'.`;
    super('MODULE_LOAD_FAILED', message);
    this.cause = cause;
  }
}

export class DeviceAlreadyExistsError extends PinoutError {
  constructor(deviceId: string) {
    super('DEVICE_ALREADY_EXISTS', `Device '${deviceId}' is already configured.`);
  }
}

export class DeviceConfigInvalidError extends PinoutError {
  readonly details: unknown;

  constructor(message: string, details?: unknown) {
    super('DEVICE_CONFIG_INVALID', message);
    this.details = details;
  }
}

export class DeviceBackendFailedError extends PinoutError {
  readonly deviceId: string;
  override readonly cause: unknown;

  constructor(deviceId: string, cause: unknown) {
    const message =
      cause instanceof Error
        ? `Backend for device '${deviceId}' failed: ${cause.message}`
        : `Backend for device '${deviceId}' failed.`;
    super('DEVICE_BACKEND_FAILED', message);
    this.cause = cause;
    this.deviceId = deviceId;
  }
}
