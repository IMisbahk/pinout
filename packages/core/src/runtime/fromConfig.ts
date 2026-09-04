import type { PolicyRule } from '../policy/types.js';
import { policiesFromDeclarative } from '../module/policies.js';
import { ensureModuleLoaded } from '../modules/registry.js';
import { readDevicesFile, type DeviceDefinition } from '../home/deviceStore.js';
import { resolveDevicesConfigPath, resolvePinoutHome } from '../home/paths.js';
import { resolveRegistrationOptions } from '../home/transportFactory.js';
import { PinoutRuntime, type PinoutRuntimeOptions } from './runtime.js';
import type { RegisterModuleDeviceOptions } from './types.js';

export interface FromConfigOptions {
  home?: string;
  devicesPath?: string;
  continueOnError?: boolean;
  includeDemoDefaults?: boolean;
  /** Optional runtime-owned governance components for configured devices. */
  halt?: PinoutRuntimeOptions['halt'];
  safetyEngine?: PinoutRuntimeOptions['safetyEngine'];
}

export interface FromConfigResult {
  runtime: PinoutRuntime;
  errors: Array<{ deviceId: string; error: unknown }>;
}

export async function createRuntimeFromConfig(
  options: FromConfigOptions = {},
): Promise<FromConfigResult> {
  const home = resolvePinoutHome(options.home);
  const devicesPath = resolveDevicesConfigPath(home, options.devicesPath);
  const devicesFile = readDevicesFile(devicesPath, home);
  const runtime = new PinoutRuntime({
    ...(options.halt ? { halt: options.halt } : {}),
    ...(options.safetyEngine ? { safetyEngine: options.safetyEngine } : {}),
  });
  const errors: Array<{ deviceId: string; error: unknown }> = [];

  const definitions = mergeDeviceDefinitions(devicesFile.devices, options);

  for (const definition of definitions) {
    if (definition.enabled === false) {
      continue;
    }
    try {
      await registerConfiguredDevice(runtime, definition, home);
    } catch (error) {
      if (options.continueOnError) {
        errors.push({ deviceId: definition.id, error });
      } else {
        await runtime.close().catch(() => undefined);
        throw error;
      }
    }
  }

  return { runtime, errors };
}

async function registerConfiguredDevice(
  runtime: PinoutRuntime,
  definition: DeviceDefinition,
  home?: string,
): Promise<void> {
  const module = await ensureModuleLoaded(definition.module, home);
  const registration = await resolveRegistrationOptions(definition, module.id);
  const deploymentPolicies: PolicyRule[] = definition.policies
    ? policiesFromDeclarative(definition.policies)
    : [];
  await runtime.registerModuleDevice(module, {
    ...registration,
    deploymentPolicies,
  } as RegisterModuleDeviceOptions);
}

function mergeDeviceDefinitions(
  configured: DeviceDefinition[],
  options: FromConfigOptions,
): DeviceDefinition[] {
  if (!options.includeDemoDefaults) {
    return configured;
  }
  const ids = new Set(configured.map((device) => device.id));
  const merged = [...configured];
  for (const demo of defaultDemoDevices()) {
    if (!ids.has(demo.id)) {
      merged.push(demo);
    }
  }
  return merged;
}

function defaultDemoDevices(): DeviceDefinition[] {
  const esp32: DeviceDefinition = {
    id: 'esp32-01',
    module: 'pinout/esp32',
    backend: process.env.PINOUT_PORT
      ? {
          type: 'protocol',
          transport: { type: 'serial', path: process.env.PINOUT_PORT, baud: 115200 },
        }
      : { type: 'protocol', transport: { type: 'simulated-esp32' } },
  };
  return [
    esp32,
    { id: 'arm-sim-01', module: 'pinout/robot-arm', backend: { type: 'simulated' } },
    {
      id: 'chamber-sim-01',
      module: 'pinout/environmental-chamber',
      backend: { type: 'simulated' },
    },
  ];
}
