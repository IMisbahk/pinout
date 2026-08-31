import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { moduleInstallDirectory, modulesIndexPath, resolvePinoutHome } from './paths.js';
import { loadModuleFromDirectory, type LoadedModule } from '../module/loadModule.js';
import {
  ModuleAlreadyInstalledError,
  ModuleInvalidError,
  ModuleNotFoundError,
} from '../module/errors.js';
import { MODULE_MANIFEST_FILENAME, readModuleManifestFromFile } from '../module/manifest.js';

export interface InstalledModuleRecord {
  id: string;
  version: string;
  deviceClass: string;
  installPath: string;
  sourcePath: string;
  installedAt: string;
  builtin?: boolean;
}

export interface ModulesIndex {
  schemaVersion: 1;
  modules: InstalledModuleRecord[];
}

export interface ModuleListEntry {
  id: string;
  version: string;
  deviceClass: string;
  source: 'builtin' | 'installed';
  installPath?: string;
}

export function ensurePinoutHome(home?: string): string {
  const resolved = resolvePinoutHome(home);
  mkdirSync(resolved, { recursive: true });
  mkdirSync(join(resolved, 'modules'), { recursive: true });
  return resolved;
}

export function readModulesIndex(home?: string): ModulesIndex {
  const resolvedHome = resolvePinoutHome(home);
  const indexPath = modulesIndexPath(resolvedHome);
  if (!existsSync(indexPath)) {
    return { schemaVersion: 1, modules: [] };
  }
  const parsed = JSON.parse(readFileSync(indexPath, 'utf8')) as ModulesIndex;
  return parsed;
}

export function writeModulesIndex(index: ModulesIndex, home?: string): void {
  const resolvedHome = ensurePinoutHome(home);
  writeFileSync(modulesIndexPath(resolvedHome), `${JSON.stringify(index, null, 2)}\n`, 'utf8');
}

export async function installModuleFromPath(
  sourcePath: string,
  options: { home?: string; force?: boolean } = {},
): Promise<InstalledModuleRecord> {
  const absoluteSource = resolve(sourcePath);
  const manifestPath = `${absoluteSource}/${MODULE_MANIFEST_FILENAME}`;
  if (!existsSync(manifestPath)) {
    throw new ModuleInvalidError(`No ${MODULE_MANIFEST_FILENAME} found in '${absoluteSource}'.`);
  }
  const manifest = readModuleManifestFromFile(manifestPath);
  const home = ensurePinoutHome(options.home);
  const index = readModulesIndex(home);
  const existing = index.modules.find((entry) => entry.id === manifest.id);
  if (existing && !options.force) {
    throw new ModuleAlreadyInstalledError(manifest.id);
  }
  const installPath = moduleInstallDirectory(home, manifest.id);
  rmSync(installPath, { recursive: true, force: true });
  mkdirSync(dirname(installPath), { recursive: true });
  cpSync(absoluteSource, installPath, { recursive: true });
  const record: InstalledModuleRecord = {
    id: manifest.id,
    version: manifest.version,
    deviceClass: manifest.deviceClass,
    installPath,
    sourcePath: absoluteSource,
    installedAt: new Date().toISOString(),
  };
  const nextModules = index.modules.filter((entry) => entry.id !== manifest.id);
  nextModules.push(record);
  writeModulesIndex({ schemaVersion: 1, modules: nextModules }, home);
  return record;
}

export function uninstallModule(moduleId: string, home?: string): void {
  const resolvedHome = resolvePinoutHome(home);
  const index = readModulesIndex(resolvedHome);
  const record = index.modules.find((entry) => entry.id === moduleId);
  if (!record) {
    throw new ModuleNotFoundError(moduleId);
  }
  if (record.builtin) {
    throw new ModuleInvalidError(`Built-in module '${moduleId}' cannot be uninstalled.`);
  }
  rmSync(record.installPath, { recursive: true, force: true });
  writeModulesIndex(
    {
      schemaVersion: 1,
      modules: index.modules.filter((entry) => entry.id !== moduleId),
    },
    resolvedHome,
  );
}

export function inspectInstalledModule(moduleId: string, home?: string): InstalledModuleRecord {
  const index = readModulesIndex(home);
  const record = index.modules.find((entry) => entry.id === moduleId);
  if (!record) {
    throw new ModuleNotFoundError(moduleId);
  }
  return record;
}

export async function loadInstalledModule(moduleId: string, home?: string): Promise<LoadedModule> {
  const record = inspectInstalledModule(moduleId, home);
  return loadModuleFromDirectory(record.installPath);
}

export function registerInstalledModuleRecord(record: InstalledModuleRecord, home?: string): void {
  const index = readModulesIndex(home);
  const without = index.modules.filter((entry) => entry.id !== record.id);
  without.push(record);
  writeModulesIndex({ schemaVersion: 1, modules: without }, home);
}
