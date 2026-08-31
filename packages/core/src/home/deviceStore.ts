import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { DeclarativePolicyMap } from '../module/policies.js';
import { DeviceAlreadyExistsError, DeviceConfigInvalidError } from '../module/errors.js';
import { resolveDevicesConfigPath, resolvePinoutHome } from './paths.js';

export interface DeviceTransportConfig {
  type: 'serial' | 'tcp' | 'simulated-esp32' | 'loopback';
  path?: string;
  host?: string;
  port?: number;
  baud?: number;
}

export interface DeviceBackendConfig {
  type: 'simulated' | 'protocol';
  transport?: DeviceTransportConfig;
}

export interface DeviceDefinition {
  id: string;
  module: string;
  label?: string;
  backend?: DeviceBackendConfig;
  config?: Record<string, unknown>;
  policies?: DeclarativePolicyMap;
  enabled?: boolean;
}

export interface DevicesFile {
  schemaVersion: 1;
  devices: DeviceDefinition[];
}

export function readDevicesFile(path?: string, home?: string): DevicesFile {
  const resolvedHome = resolvePinoutHome(home);
  const configPath = resolveDevicesConfigPath(resolvedHome, path);
  if (!existsSync(configPath)) {
    return { schemaVersion: 1, devices: [] };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(configPath, 'utf8'));
  } catch (error) {
    throw new DeviceConfigInvalidError(
      `Failed to parse devices config: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return parseDevicesFile(parsed);
}

export function writeDevicesFile(devicesFile: DevicesFile, path?: string, home?: string): void {
  const resolvedHome = resolvePinoutHome(home);
  const configPath = resolveDevicesConfigPath(resolvedHome, path);
  mkdirSync(resolvePinoutHome(resolvedHome), { recursive: true });
  writeFileSync(configPath, `${JSON.stringify(devicesFile, null, 2)}\n`, 'utf8');
}

export function addDeviceDefinition(
  definition: DeviceDefinition,
  options: { path?: string; home?: string } = {},
): DeviceDefinition {
  assertValidDeviceDefinition(definition);
  const file = readDevicesFile(options.path, options.home);
  if (file.devices.some((entry) => entry.id === definition.id)) {
    throw new DeviceAlreadyExistsError(definition.id);
  }
  file.devices.push(definition);
  writeDevicesFile(file, options.path, options.home);
  return definition;
}

export function removeDeviceDefinition(
  deviceId: string,
  options: { path?: string; home?: string } = {},
): void {
  const file = readDevicesFile(options.path, options.home);
  const next = file.devices.filter((entry) => entry.id !== deviceId);
  if (next.length === file.devices.length) {
    throw new DeviceConfigInvalidError(`Device '${deviceId}' is not configured.`);
  }
  writeDevicesFile({ schemaVersion: 1, devices: next }, options.path, options.home);
}

export function inspectDeviceDefinition(
  deviceId: string,
  options: { path?: string; home?: string } = {},
): DeviceDefinition {
  const file = readDevicesFile(options.path, options.home);
  const device = file.devices.find((entry) => entry.id === deviceId);
  if (!device) {
    throw new DeviceConfigInvalidError(`Device '${deviceId}' is not configured.`);
  }
  return device;
}

function parseDevicesFile(raw: unknown): DevicesFile {
  if (!raw || typeof raw !== 'object') {
    throw new DeviceConfigInvalidError('Devices config must be a JSON object.');
  }
  const object = raw as Record<string, unknown>;
  if (object.schemaVersion !== 1) {
    throw new DeviceConfigInvalidError('Unsupported devices schemaVersion.');
  }
  if (!Array.isArray(object.devices)) {
    throw new DeviceConfigInvalidError('Devices config must include a devices array.');
  }
  const devices = object.devices.map((entry) => {
    if (!entry || typeof entry !== 'object') {
      throw new DeviceConfigInvalidError('Each device entry must be an object.');
    }
    const device = entry as Record<string, unknown>;
    const id = device.id;
    const moduleId = device.module;
    if (typeof id !== 'string' || typeof moduleId !== 'string') {
      throw new DeviceConfigInvalidError('Each device requires string id and module fields.');
    }
    const parsed: DeviceDefinition = { id, module: moduleId };
    if (typeof device.label === 'string') {
      parsed.label = device.label;
    }
    if (device.backend && typeof device.backend === 'object') {
      parsed.backend = device.backend as DeviceBackendConfig;
    }
    if (device.config && typeof device.config === 'object') {
      parsed.config = device.config as Record<string, unknown>;
    }
    if (device.policies && typeof device.policies === 'object') {
      parsed.policies = device.policies as DeclarativePolicyMap;
    }
    if (device.enabled === false) {
      parsed.enabled = false;
    }
    return parsed;
  });
  return { schemaVersion: 1, devices };
}

function assertValidDeviceDefinition(definition: DeviceDefinition): void {
  if (!definition.id || !definition.module) {
    throw new DeviceConfigInvalidError('Device id and module are required.');
  }
}
