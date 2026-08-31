import { readFileSync } from 'node:fs';
import { ModuleIncompatibleError, ModuleInvalidError } from './errors.js';
import { assertValidModuleId, assertValidSemver, compareSemver } from './validate.js';
import { PINOUT_VERSION } from '../version.js';

export const MODULE_MANIFEST_FILENAME = 'pinout.module.json';

export interface PinoutModuleManifest {
  schemaVersion: number;
  id: string;
  version: string;
  deviceClass: string;
  entrypoint: string;
  name?: string;
  description?: string;
  vendor?: string;
  model?: string;
  pinout?: {
    minimumVersion?: string;
  };
}

export function parseModuleManifest(raw: unknown): PinoutModuleManifest {
  if (!raw || typeof raw !== 'object') {
    throw new ModuleInvalidError('Module manifest must be a JSON object.');
  }
  const manifest = raw as Record<string, unknown>;
  const schemaVersion = manifest.schemaVersion;
  if (schemaVersion !== 1) {
    throw new ModuleInvalidError(`Unsupported manifest schemaVersion '${String(schemaVersion)}'.`);
  }
  const id = readString(manifest, 'id');
  const version = readString(manifest, 'version');
  const deviceClass = readString(manifest, 'deviceClass');
  const entrypoint = readString(manifest, 'entrypoint');
  assertValidModuleId(id);
  assertValidSemver(version);
  const pinout = readOptionalObject(manifest, 'pinout');
  const minimumVersion = pinout?.minimumVersion;
  if (typeof minimumVersion === 'string') {
    assertValidSemver(minimumVersion, 'pinout.minimumVersion');
    if (compareSemver(PINOUT_VERSION, minimumVersion) < 0) {
      throw new ModuleIncompatibleError(id, minimumVersion, PINOUT_VERSION);
    }
  }
  const result: PinoutModuleManifest = {
    schemaVersion: 1,
    id,
    version,
    deviceClass,
    entrypoint,
  };
  const name = readOptionalString(manifest, 'name');
  const description = readOptionalString(manifest, 'description');
  const vendor = readOptionalString(manifest, 'vendor');
  const model = readOptionalString(manifest, 'model');
  if (name !== undefined) {
    result.name = name;
  }
  if (description !== undefined) {
    result.description = description;
  }
  if (vendor !== undefined) {
    result.vendor = vendor;
  }
  if (model !== undefined) {
    result.model = model;
  }
  if (typeof minimumVersion === 'string') {
    result.pinout = { minimumVersion };
  }
  return result;
}

export function readModuleManifestFromFile(path: string): PinoutModuleManifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new ModuleInvalidError(
      `Failed to parse ${MODULE_MANIFEST_FILENAME}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return parseModuleManifest(parsed);
}

function readString(object: Record<string, unknown>, key: string): string {
  const value = object[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new ModuleInvalidError(`Manifest field '${key}' must be a non-empty string.`);
  }
  return value;
}

function readOptionalString(object: Record<string, unknown>, key: string): string | undefined {
  const value = object[key];
  return typeof value === 'string' ? value : undefined;
}

function readOptionalObject(
  object: Record<string, unknown>,
  key: string,
): Record<string, unknown> | undefined {
  const value = object[key];
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
