import { chamberModule } from '../modules/chamberModule.js';
import { dcMotorModule } from '../modules/dcMotorModule.js';
import { distanceModule } from '../modules/distanceModule.js';
import { encoderModule } from '../modules/encoderModule.js';
import { esp32Module } from '../modules/esp32Module.js';
import { forceModule } from '../modules/forceModule.js';
import { imuModule } from '../modules/imuModule.js';
import { limitSwitchModule } from '../modules/limitSwitchModule.js';
import { mobileBaseModule } from '../modules/mobileBaseModule.js';
import { robotArmModule } from '../modules/robotArmModule.js';
import { servoModule } from '../modules/servoModule.js';
import { stepperModule } from '../modules/stepperModule.js';
import { powerSupplyModule, pumpModule, relayModule, valveModule } from './semanticModules.js';
import type { PinoutModuleDefinition } from '../runtime/types.js';
import { ModuleNotFoundError } from '../module/errors.js';
import { loadInstalledModule, readModulesIndex } from '../home/moduleStore.js';
import { resolvePinoutHome } from '../home/paths.js';

const builtinModules = new Map<string, PinoutModuleDefinition>([
  [esp32Module.id, esp32Module],
  [robotArmModule.id, robotArmModule],
  [chamberModule.id, chamberModule],
  [dcMotorModule.id, dcMotorModule],
  [servoModule.id, servoModule],
  [stepperModule.id, stepperModule],
  [distanceModule.id, distanceModule],
  [imuModule.id, imuModule],
  [encoderModule.id, encoderModule],
  [limitSwitchModule.id, limitSwitchModule],
  [forceModule.id, forceModule],
  [mobileBaseModule.id, mobileBaseModule],
  [relayModule.id, relayModule],
  [valveModule.id, valveModule],
  [pumpModule.id, pumpModule],
  [powerSupplyModule.id, powerSupplyModule],
]);

const runtimeModules = new Map<string, PinoutModuleDefinition>();

export function getModule(moduleId: string): PinoutModuleDefinition {
  const runtime = runtimeModules.get(moduleId);
  if (runtime) {
    return runtime;
  }
  const builtin = builtinModules.get(moduleId);
  if (builtin) {
    return builtin;
  }
  throw new ModuleNotFoundError(moduleId);
}

export function listModules(): PinoutModuleDefinition[] {
  const ids = new Set<string>([...builtinModules.keys(), ...runtimeModules.keys()]);
  return [...ids].map((id) => getModule(id));
}

export function registerModule(module: PinoutModuleDefinition): void {
  runtimeModules.set(module.id, module);
}

export function isBuiltinModule(moduleId: string): boolean {
  return builtinModules.has(moduleId);
}

export function listAvailableModules(home?: string): Array<{
  id: string;
  version: string;
  deviceClass: string;
  source: 'builtin' | 'installed';
}> {
  const resolvedHome = resolvePinoutHome(home);
  const installed = readModulesIndex(resolvedHome).modules;
  const entries = new Map<
    string,
    { id: string; version: string; deviceClass: string; source: 'builtin' | 'installed' }
  >();
  for (const [id, module] of builtinModules) {
    entries.set(id, {
      id,
      version: module.version,
      deviceClass: module.deviceClass,
      source: 'builtin',
    });
  }
  for (const record of installed) {
    entries.set(record.id, {
      id: record.id,
      version: record.version,
      deviceClass: record.deviceClass,
      source: 'installed',
    });
  }
  return [...entries.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export async function ensureModuleLoaded(
  moduleId: string,
  home?: string,
): Promise<PinoutModuleDefinition> {
  if (runtimeModules.has(moduleId) || builtinModules.has(moduleId)) {
    return getModule(moduleId);
  }
  const { module } = await loadInstalledModule(moduleId, home);
  registerModule(module);
  return module;
}

export async function loadAllInstalledModules(home?: string): Promise<void> {
  const index = readModulesIndex(home);
  for (const record of index.modules) {
    if (builtinModules.has(record.id)) {
      continue;
    }
    const { module } = await loadInstalledModule(record.id, home);
    registerModule(module);
  }
}

export function resetRuntimeModulesForTests(): void {
  runtimeModules.clear();
}
