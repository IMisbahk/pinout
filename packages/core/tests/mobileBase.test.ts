import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  PINOUT_CONFIG_ENV,
  PINOUT_HOME_ENV,
  PinoutRuntime,
  PolicyConstraintViolation,
  createRoboticsWorkbench,
  createSimulatedMobileBaseBackend,
  defaultRoboticsDeviceIds,
  listAvailableModules,
  mobileBaseModuleId,
} from '@pinout/core';

describe('simulated mobile base', () => {
  it('integrates pose from commanded velocity', async () => {
    const base = createSimulatedMobileBaseBackend({ integrationDt: 1 });
    await base.invoke('drive.set_velocity', { linear: 0.5, angular: 0 });
    expect(await base.invoke('pose.read', {})).toEqual({ x: 0.5, y: 0, heading: 0 });
    await base.invoke('drive.stop', {});
    const status = await base.invoke('status.read', {});
    expect(status.status).toBe('stopped');
    expect(status.linear).toBe(0);
    await base.close();
  });

  it('emits drive.changed', async () => {
    const base = createSimulatedMobileBaseBackend({ integrationDt: 0 });
    const events: string[] = [];
    base.subscribe((event) => events.push(event));
    await base.invoke('drive.set_velocity', { linear: 0.1, angular: 0.2 });
    expect(events).toContain('drive.changed');
    await base.close();
  });
});

describe('mobile base module in runtime', () => {
  it('is listed as a built-in module', () => {
    expect(listAvailableModules().map((entry) => entry.id)).toContain(mobileBaseModuleId);
  });

  it('enforces velocity policies', async () => {
    const runtime = new PinoutRuntime();
    await runtime.registerFromModule(mobileBaseModuleId, { id: 'base-01', simulated: true });
    try {
      await runtime.invoke('base-01', 'drive.set_velocity', { linear: 0.2, angular: 0.1 });
      await expect(
        runtime.invoke('base-01', 'drive.set_velocity', { linear: 9, angular: 0 }),
      ).rejects.toBeInstanceOf(PolicyConstraintViolation);
    } finally {
      await runtime.close();
    }
  });
});

describe('robotics workbench', () => {
  let pinoutHome: string;
  const previousHome = process.env[PINOUT_HOME_ENV];
  const previousConfig = process.env[PINOUT_CONFIG_ENV];

  beforeEach(() => {
    pinoutHome = mkdtempSync(join(tmpdir(), 'pinout-workbench-'));
    process.env[PINOUT_HOME_ENV] = pinoutHome;
    delete process.env[PINOUT_CONFIG_ENV];
  });

  afterEach(async () => {
    if (previousHome === undefined) {
      delete process.env[PINOUT_HOME_ENV];
    } else {
      process.env[PINOUT_HOME_ENV] = previousHome;
    }
    if (previousConfig === undefined) {
      delete process.env[PINOUT_CONFIG_ENV];
    } else {
      process.env[PINOUT_CONFIG_ENV] = previousConfig;
    }
    rmSync(pinoutHome, { recursive: true, force: true });
  });

  it('registers actuators, sensors, and a mobile base alongside the lab set', async () => {
    const runtime = await createRoboticsWorkbench({ motionDelayMs: 0 });
    try {
      const ids = runtime.devices().map((device) => device.id);
      expect(ids).toEqual(
        expect.arrayContaining([
          defaultRoboticsDeviceIds.esp32,
          defaultRoboticsDeviceIds.arm,
          defaultRoboticsDeviceIds.motor,
          defaultRoboticsDeviceIds.distance,
          defaultRoboticsDeviceIds.base,
        ]),
      );
      expect(runtime.devices()).toHaveLength(12);

      await runtime.invoke(defaultRoboticsDeviceIds.motor, 'motor.set', { speed: 0.3 });
      await runtime.invoke(defaultRoboticsDeviceIds.base, 'drive.set_velocity', {
        linear: 0.2,
        angular: 0,
      });
      const range = await runtime.invoke(defaultRoboticsDeviceIds.distance, 'distance.read', {});
      expect(range.meters).toBe(0.42);
    } finally {
      await runtime.close();
    }
  });
});
