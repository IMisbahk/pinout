import { describe, expect, it } from 'vitest';
import {
  PinoutRuntime,
  createSimulatedDistanceBackend,
  createSimulatedEncoderBackend,
  createSimulatedForceBackend,
  createSimulatedImuBackend,
  createSimulatedLimitSwitchBackend,
  distanceModuleId,
  encoderModuleId,
  forceModuleId,
  imuModuleId,
  limitSwitchModuleId,
  listAvailableModules,
} from '@pinout/core';

describe('simulated sensors', () => {
  it('reads a configured rangefinder distance', async () => {
    const sensor = createSimulatedDistanceBackend({ meters: 1.25 });
    expect(await sensor.invoke('distance.read', {})).toEqual({ meters: 1.25 });
    await sensor.close();
  });

  it('returns rest IMU samples', async () => {
    const imu = createSimulatedImuBackend();
    expect(await imu.invoke('imu.read', {})).toEqual({
      accel: { x: 0, y: 0, z: 1 },
      gyro: { x: 0, y: 0, z: 0 },
    });
    await imu.close();
  });

  it('resets encoder ticks', async () => {
    const encoder = createSimulatedEncoderBackend({ ticks: 480 });
    expect(await encoder.invoke('encoder.read', {})).toEqual({ ticks: 480 });
    expect(await encoder.invoke('encoder.reset', {})).toEqual({ ticks: 0 });
    await encoder.close();
  });

  it('reports a triggered limit switch', async () => {
    const limit = createSimulatedLimitSwitchBackend({ triggered: true });
    expect(await limit.invoke('limit.read', {})).toEqual({ triggered: true });
    await limit.close();
  });

  it('reads force in newtons', async () => {
    const force = createSimulatedForceBackend({ newtons: 12.5 });
    expect(await force.invoke('force.read', {})).toEqual({ newtons: 12.5 });
    await force.close();
  });
});

describe('sensor modules in runtime', () => {
  it('lists first-party sensor modules', () => {
    const ids = listAvailableModules().map((entry) => entry.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        distanceModuleId,
        imuModuleId,
        encoderModuleId,
        limitSwitchModuleId,
        forceModuleId,
      ]),
    );
  });

  it('invokes sensors through the runtime', async () => {
    const runtime = new PinoutRuntime();
    await runtime.registerFromModule(distanceModuleId, {
      id: 'range-01',
      simulated: true,
      backendOptions: { meters: 0.8 },
    });
    try {
      expect(await runtime.invoke('range-01', 'distance.read', {})).toEqual({ meters: 0.8 });
    } finally {
      await runtime.close();
    }
  });
});
