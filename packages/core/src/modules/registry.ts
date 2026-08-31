import { chamberModule } from './chamberModule.js';
import { esp32Module } from './esp32Module.js';
import { robotArmModule } from './robotArmModule.js';
import type { PinoutModuleDefinition } from '../runtime/types.js';

const modules = new Map<string, PinoutModuleDefinition>([
  [esp32Module.id, esp32Module],
  [robotArmModule.id, robotArmModule],
  [chamberModule.id, chamberModule],
]);

export function getModule(moduleId: string): PinoutModuleDefinition {
  const module = modules.get(moduleId);
  if (!module) {
    throw new Error(`Unknown Pinout module '${moduleId}'.`);
  }
  return module;
}

export function listModules(): PinoutModuleDefinition[] {
  return [...modules.values()];
}

export function registerModule(module: PinoutModuleDefinition): void {
  modules.set(module.id, module);
}
