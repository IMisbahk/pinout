import { loadPinoutConfig } from '../config.js';
import { serialPort } from '../serial.js';
import type { Transport } from '../types.js';
import { chamberModuleId } from '../modules/chamberModule.js';
import { createEsp32SimulatedTransport, esp32ModuleId } from '../modules/esp32Module.js';
import { robotArmModuleId } from '../modules/robotArmModule.js';
import { PinoutRuntime } from './runtime.js';

export interface HeterogeneousRuntimeOptions {
  esp32Id?: string;
  armId?: string;
  chamberId?: string;
  esp32Transport?: Transport;
  useHardwareEsp32?: boolean;
  motionDelayMs?: number;
  includeArm?: boolean;
  includeChamber?: boolean;
}

export async function createHeterogeneousRuntime(
  options: HeterogeneousRuntimeOptions = {},
): Promise<PinoutRuntime> {
  const runtime = new PinoutRuntime();
  const config = loadPinoutConfig();

  const esp32Id = options.esp32Id ?? 'esp32-01';
  let esp32Transport = options.esp32Transport;

  if (!esp32Transport) {
    if (options.useHardwareEsp32 && config.port) {
      esp32Transport = serialPort({ path: config.port, baudRate: config.baudRate });
    } else {
      esp32Transport = createEsp32SimulatedTransport();
    }
  }

  await runtime.registerFromModule(esp32ModuleId, {
    id: esp32Id,
    label: options.useHardwareEsp32 ? 'ESP32 hardware' : 'ESP32 simulator',
    simulated: !options.useHardwareEsp32,
    transport: esp32Transport,
  });

  if (options.includeArm !== false) {
    await runtime.registerFromModule(robotArmModuleId, {
      id: options.armId ?? 'arm-sim-01',
      label: 'Simulated robot arm',
      simulated: true,
      backendOptions: { motionDelayMs: options.motionDelayMs ?? 5 },
    });
  }

  if (options.includeChamber !== false) {
    await runtime.registerFromModule(chamberModuleId, {
      id: options.chamberId ?? 'chamber-sim-01',
      label: 'Simulated environmental chamber',
      simulated: true,
    });
  }

  return runtime;
}

export const defaultHeterogeneousDeviceIds = {
  esp32: 'esp32-01',
  arm: 'arm-sim-01',
  chamber: 'chamber-sim-01',
} as const;
