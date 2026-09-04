import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
  readdirSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
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
  status?: 'CANDIDATE' | 'REVIEWED' | 'TESTED';
  manifestHash?: string;
  contentHash?: string;
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
  options: { home?: string; force?: boolean; allowCandidate?: boolean; downgrade?: boolean } = {},
): Promise<InstalledModuleRecord> {
  const absoluteSource = resolve(sourcePath);
  const manifestPath = `${absoluteSource}/${MODULE_MANIFEST_FILENAME}`;
  if (!existsSync(manifestPath)) {
    throw new ModuleInvalidError(`No ${MODULE_MANIFEST_FILENAME} found in '${absoluteSource}'.`);
  }
  const manifest = readModuleManifestFromFile(manifestPath);
  if (manifest.status === 'CANDIDATE' && !options.allowCandidate) {
    throw new ModuleInvalidError(
      `Module '${manifest.id}' is CANDIDATE; pass --allow-candidate after review.`,
    );
  }
  const home = ensurePinoutHome(options.home);
  const index = readModulesIndex(home);
  const existing = index.modules.find((entry) => entry.id === manifest.id);
  if (existing && !options.force) {
    throw new ModuleAlreadyInstalledError(manifest.id);
  }
  if (existing && compareVersions(manifest.version, existing.version) < 0 && !options.downgrade) {
    throw new ModuleInvalidError(
      `Refusing downgrade of '${manifest.id}' from ${existing.version} to ${manifest.version}; pass --downgrade.`,
    );
  }
  if (existing) {
    assertSafeInstallPath(existing.installPath, home);
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
    status: manifest.status,
    manifestHash: hash(JSON.stringify(manifest)),
    contentHash: directoryHash(absoluteSource),
  };
  const nextModules = index.modules.filter((entry) => entry.id !== manifest.id);
  nextModules.push(record);
  writeModulesIndex({ schemaVersion: 1, modules: nextModules }, home);
  return record;
}

function compareVersions(a: string, b: string): number {
  const parse = (value: string) => (value.split('-')[0] ?? '').split('.').map(Number);
  const av = parse(a);
  const bv = parse(b);
  for (let i = 0; i < 3; i += 1)
    if ((av[i] ?? 0) !== (bv[i] ?? 0)) return (av[i] ?? 0) - (bv[i] ?? 0);
  return 0;
}
function hash(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}
function directoryHash(root: string): string {
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      if (['node_modules', 'dist', '.git', 'coverage', '.pinout-cache'].includes(entry.name))
        continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name !== 'pinout.module.sig')
        files.push(`${relative(root, full).split(sep).join('/')}:${hash(readFileSync(full))}`);
    }
  };
  walk(root);
  return hash(files.sort().join('\n'));
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
  assertSafeInstallPath(record.installPath, resolvedHome);
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
  const resolvedHome = resolvePinoutHome(home);
  const record = inspectInstalledModule(moduleId, resolvedHome);
  assertSafeInstallPath(record.installPath, resolvedHome);
  return loadModuleFromDirectory(record.installPath);
}

/** Validate index-controlled paths before they are used for import or deletion. */
function assertSafeInstallPath(installPath: string, home: string): void {
  const modulesRoot = resolve(home, 'modules');
  const candidate = resolve(installPath);
  if (!isContained(modulesRoot, candidate)) {
    throw new ModuleInvalidError(
      `Installed module path '${installPath}' is outside the Pinout modules directory.`,
    );
  }
  if (existsSync(candidate)) {
    let realRoot: string;
    let realCandidate: string;
    try {
      realRoot = realpathSync(modulesRoot);
      realCandidate = realpathSync(candidate);
    } catch (error) {
      throw new ModuleInvalidError(
        `Unable to validate installed module path '${installPath}'.`,
        error,
      );
    }
    if (!isContained(realRoot, realCandidate)) {
      throw new ModuleInvalidError(
        `Installed module path '${installPath}' resolves outside the Pinout modules directory.`,
      );
    }
  }
}

function isContained(parent: string, child: string): boolean {
  const path = relative(resolve(parent), resolve(child));
  return path === '' || (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path));
}

export function registerInstalledModuleRecord(record: InstalledModuleRecord, home?: string): void {
  const index = readModulesIndex(home);
  const without = index.modules.filter((entry) => entry.id !== record.id);
  without.push(record);
  writeModulesIndex({ schemaVersion: 1, modules: without }, home);
}
