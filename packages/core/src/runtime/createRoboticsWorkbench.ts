import { dcMotorModuleId } from '../modules/dcMotorModule.js';
import { distanceModuleId } from '../modules/distanceModule.js';
import { encoderModuleId } from '../modules/encoderModule.js';
import { forceModuleId } from '../modules/forceModule.js';
import { imuModuleId } from '../modules/imuModule.js';
import { limitSwitchModuleId } from '../modules/limitSwitchModule.js';
import { mobileBaseModuleId } from '../modules/mobileBaseModule.js';
import { servoModuleId } from '../modules/servoModule.js';
import { stepperModuleId } from '../modules/stepperModule.js';
import {
  createHeterogeneousRuntime,
  type HeterogeneousRuntimeOptions,
} from './createHeterogeneousRuntime.js';
import type { PinoutRuntime } from './runtime.js';

export interface RoboticsWorkbenchOptions extends HeterogeneousRuntimeOptions {
  includeActuators?: boolean;
  includeSensors?: boolean;
  includeMobileBase?: boolean;
}

export async function createRoboticsWorkbench(
  options: RoboticsWorkbenchOptions = {},
): Promise<PinoutRuntime> {
  const runtime = await createHeterogeneousRuntime(options);

  if (options.includeActuators !== false) {
    await runtime.registerFromModule(dcMotorModuleId, {
      id: defaultRoboticsDeviceIds.motor,
      label: 'Simulated DC motor',
      simulated: true,
    });
    await runtime.registerFromModule(servoModuleId, {
      id: defaultRoboticsDeviceIds.servo,
      label: 'Simulated servo',
      simulated: true,
    });
    await runtime.registerFromModule(stepperModuleId, {
      id: defaultRoboticsDeviceIds.stepper,
      label: 'Simulated stepper',
      simulated: true,
    });
  }

  if (options.includeSensors !== false) {
    await runtime.registerFromModule(distanceModuleId, {
      id: defaultRoboticsDeviceIds.distance,
      label: 'Simulated rangefinder',
      simulated: true,
      backendOptions: { meters: 0.42 },
    });
    await runtime.registerFromModule(imuModuleId, {
      id: defaultRoboticsDeviceIds.imu,
      label: 'Simulated IMU',
      simulated: true,
    });
    await runtime.registerFromModule(encoderModuleId, {
      id: defaultRoboticsDeviceIds.encoder,
      label: 'Simulated encoder',
      simulated: true,
      backendOptions: { ticks: 120 },
    });
    await runtime.registerFromModule(limitSwitchModuleId, {
      id: defaultRoboticsDeviceIds.limit,
      label: 'Simulated limit switch',
      simulated: true,
    });
    await runtime.registerFromModule(forceModuleId, {
      id: defaultRoboticsDeviceIds.force,
      label: 'Simulated force sensor',
      simulated: true,
      backendOptions: { newtons: 3.2 },
    });
  }

  if (options.includeMobileBase !== false) {
    await runtime.registerFromModule(mobileBaseModuleId, {
      id: defaultRoboticsDeviceIds.base,
      label: 'Simulated mobile base',
      simulated: true,
    });
  }

  return runtime;
}

export const defaultRoboticsDeviceIds = {
  esp32: 'esp32-01',
  arm: 'arm-sim-01',
  chamber: 'chamber-sim-01',
  motor: 'motor-sim-01',
  servo: 'servo-sim-01',
  stepper: 'stepper-sim-01',
  distance: 'range-sim-01',
  imu: 'imu-sim-01',
  encoder: 'encoder-sim-01',
  limit: 'limit-sim-01',
  force: 'force-sim-01',
  base: 'base-sim-01',
} as const;
