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
  runtime: 'node' | 'python';
  capabilities: string[];
  permissions?: unknown;
  simulation: { provided: boolean; simulator?: string; notes?: string };
  status: 'CANDIDATE' | 'REVIEWED' | 'TESTED';
  provenance?: Record<string, unknown>;
  name?: string;
  description?: string;
  vendor?: string;
  model?: string;
  pinout?: {
    minimumVersion?: string;
    maximumMajor?: number;
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
  const allowed = new Set(['schemaVersion','id','version','deviceClass','entrypoint','runtime','capabilities','permissions','simulation','status','provenance','name','description','vendor','model','pinout']);
  const unknown = Object.keys(manifest).filter((key) => !allowed.has(key));
  if (unknown.length > 0) throw new ModuleInvalidError(`Unknown manifest field '${unknown[0]}'.`);
  const id = readString(manifest, 'id');
  const version = readString(manifest, 'version');
  const deviceClass = readString(manifest, 'deviceClass');
  const entrypoint = readString(manifest, 'entrypoint');
  const legacy = manifest.runtime === undefined && manifest.status === undefined;
  const runtime = manifest.runtime === undefined ? 'node' : readEnum(manifest, 'runtime', ['node', 'python'] as const);
  const capabilities = manifest.capabilities === undefined ? [] : readStringArray(manifest, 'capabilities');
  const status = manifest.status === undefined ? 'REVIEWED' : readEnum(manifest, 'status', ['CANDIDATE', 'REVIEWED', 'TESTED'] as const);
  const simulation = manifest.simulation === undefined ? { provided: false } : readSimulation(manifest.simulation);
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
  const maximumMajorRaw = pinout?.maximumMajor;
  if (maximumMajorRaw !== undefined && (typeof maximumMajorRaw !== 'number' || !Number.isInteger(maximumMajorRaw) || maximumMajorRaw < 0)) {
    throw new ModuleInvalidError("Manifest field 'pinout.maximumMajor' must be a non-negative integer.");
  }
  const maximumMajor = maximumMajorRaw as number | undefined;
  const result: PinoutModuleManifest = {
    schemaVersion: 1,
    id,
    version,
    deviceClass,
    entrypoint,
    runtime,
    capabilities,
    simulation,
    status,
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
    result.pinout = { minimumVersion, ...(maximumMajor === undefined ? {} : { maximumMajor }) };
  } else if (maximumMajor !== undefined) {
    result.pinout = { maximumMajor };
  }
  if (manifest.permissions !== undefined) result.permissions = manifest.permissions;
  if (manifest.provenance !== undefined) result.provenance = readObject(manifest, 'provenance');
  if (legacy) console.warn(`Legacy module manifest '${id}' is accepted for one alpha cycle; add runtime, capabilities, simulation, and status.`);
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

function readEnum<T extends string>(object: Record<string, unknown>, key: string, values: readonly T[]): T {
  const value = object[key];
  if (typeof value !== 'string' || !values.includes(value as T)) throw new ModuleInvalidError(`Manifest field '${key}' must be one of ${values.join(', ')}.`);
  return value as T;
}

function readStringArray(object: Record<string, unknown>, key: string): string[] {
  const value = object[key];
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || item.length === 0)) throw new ModuleInvalidError(`Manifest field '${key}' must be an array of non-empty strings.`);
  return [...value];
}

function readObject(object: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = object[key];
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ModuleInvalidError(`Manifest field '${key}' must be an object.`);
  return { ...(value as Record<string, unknown>) };
}

function readSimulation(value: unknown): PinoutModuleManifest['simulation'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ModuleInvalidError("Manifest field 'simulation' must be an object.");
  const record = value as Record<string, unknown>;
  if (typeof record.provided !== 'boolean') throw new ModuleInvalidError("Manifest field 'simulation.provided' must be boolean.");
  const result: PinoutModuleManifest['simulation'] = { provided: record.provided };
  if (record.simulator !== undefined) { if (typeof record.simulator !== 'string' || !record.simulator) throw new ModuleInvalidError("Manifest field 'simulation.simulator' must be a non-empty string."); result.simulator = record.simulator; }
  if (record.notes !== undefined) { if (typeof record.notes !== 'string') throw new ModuleInvalidError("Manifest field 'simulation.notes' must be a string."); result.notes = record.notes; }
  const unknown = Object.keys(record).filter((key) => !['provided','simulator','notes'].includes(key));
  if (unknown.length) throw new ModuleInvalidError(`Unknown manifest field 'simulation.${unknown[0]}'.`);
  return result;
}
