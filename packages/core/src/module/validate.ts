import { ModuleInvalidError } from './errors.js';
import type { DefineModuleInput } from './defineModule.js';

const MODULE_ID_PATTERN = /^[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9-]*$/;
const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?(?:\+[a-zA-Z0-9.-]+)?$/;

export function assertValidModuleId(id: string): void {
  if (!MODULE_ID_PATTERN.test(id)) {
    throw new ModuleInvalidError(
      `Module id '${id}' is invalid. Expected format 'vendor/name' using lowercase letters, digits, and hyphens.`,
    );
  }
}

export function assertValidSemver(version: string, label = 'version'): void {
  if (!SEMVER_PATTERN.test(version)) {
    throw new ModuleInvalidError(`${label} '${version}' is not valid semantic version.`);
  }
}

export function validateModuleInput(input: DefineModuleInput): void {
  assertValidModuleId(input.id);
  assertValidSemver(input.version);
  if (!input.device?.class) {
    throw new ModuleInvalidError('Module device.class is required.');
  }
  if (!Array.isArray(input.capabilities) || input.capabilities.length === 0) {
    throw new ModuleInvalidError('Module must declare at least one capability.');
  }
  const names = new Set<string>();
  for (const capability of input.capabilities) {
    if (!capability.name) {
      throw new ModuleInvalidError('Every capability must have a name.');
    }
    if (names.has(capability.name)) {
      throw new ModuleInvalidError(`Duplicate capability '${capability.name}'.`);
    }
    names.add(capability.name);
    if (!capability.inputSchema || typeof capability.inputSchema !== 'object') {
      throw new ModuleInvalidError(`Capability '${capability.name}' must define inputSchema.`);
    }
    if (!capability.outputSchema || typeof capability.outputSchema !== 'object') {
      throw new ModuleInvalidError(`Capability '${capability.name}' must define outputSchema.`);
    }
  }
  if (typeof input.createBackend !== 'function') {
    throw new ModuleInvalidError('Module createBackend must be a function.');
  }
}

export function compareSemver(a: string, b: string): number {
  const parse = (value: string): number[] =>
    value
      .split('-')[0]
      ?.split('.')
      .map((part) => Number.parseInt(part, 10)) ?? [];
  const av = parse(a);
  const bv = parse(b);
  for (let index = 0; index < 3; index += 1) {
    const diff = (av[index] ?? 0) - (bv[index] ?? 0);
    if (diff !== 0) {
      return diff;
    }
  }
  return 0;
}
