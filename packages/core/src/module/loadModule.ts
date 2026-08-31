import { pathToFileURL } from 'node:url';
import { join, resolve } from 'node:path';
import type { PinoutModuleDefinition } from '../runtime/types.js';
import { ModuleInvalidError, ModuleLoadFailedError } from './errors.js';
import {
  MODULE_MANIFEST_FILENAME,
  readModuleManifestFromFile,
  type PinoutModuleManifest,
} from './manifest.js';
import { assertValidModuleId } from './validate.js';

export interface LoadedModule {
  manifest: PinoutModuleManifest;
  module: PinoutModuleDefinition;
  installPath: string;
}

export async function loadModuleFromDirectory(moduleDirectory: string): Promise<LoadedModule> {
  const installPath = resolve(moduleDirectory);
  const manifestPath = join(installPath, MODULE_MANIFEST_FILENAME);
  const manifest = readModuleManifestFromFile(manifestPath);
  const module = await importModuleEntrypoint(installPath, manifest);
  assertLoadedModuleMatchesManifest(module, manifest);
  return { manifest, module, installPath };
}

async function importModuleEntrypoint(
  installPath: string,
  manifest: PinoutModuleManifest,
): Promise<PinoutModuleDefinition> {
  const entryPath = resolve(installPath, manifest.entrypoint);
  try {
    const imported = await import(pathToFileURL(entryPath).href);
    const definition = imported.default ?? imported.module;
    if (!definition || typeof definition !== 'object') {
      throw new ModuleInvalidError('Module entrypoint must export a default Pinout module.');
    }
    return definition as PinoutModuleDefinition;
  } catch (error) {
    if (error instanceof ModuleInvalidError) {
      throw error;
    }
    throw new ModuleLoadFailedError(manifest.id, error);
  }
}

function assertLoadedModuleMatchesManifest(
  module: PinoutModuleDefinition,
  manifest: PinoutModuleManifest,
): void {
  assertValidModuleId(module.id);
  if (module.id !== manifest.id) {
    throw new ModuleInvalidError(
      `Module export id '${module.id}' does not match manifest id '${manifest.id}'.`,
    );
  }
  if (module.version !== manifest.version) {
    throw new ModuleInvalidError(
      `Module export version '${module.version}' does not match manifest version '${manifest.version}'.`,
    );
  }
  if (module.deviceClass !== manifest.deviceClass) {
    throw new ModuleInvalidError(
      `Module export deviceClass '${module.deviceClass}' does not match manifest deviceClass '${manifest.deviceClass}'.`,
    );
  }
}
