import { describe, expect, it } from 'vitest';
import {
  DuplicateDeviceError,
  DeviceNotFoundError,
  PolicyConstraintViolation,
  PolicyPreconditionFailed,
  createHeterogeneousRuntime,
  defaultHeterogeneousDeviceIds,
} from '@pinout/core';

const ids = defaultHeterogeneousDeviceIds;

describe('PinoutRuntime heterogeneous', () => {
  it('registers three device classes', async () => {
    const runtime = await createHeterogeneousRuntime({ motionDelayMs: 0 });
    try {
      const devices = runtime.devices();
      expect(devices).toHaveLength(3);
      expect(devices.map((device) => device.deviceClass).sort()).toEqual([
        'lab.environmental_chamber',
        'microcontroller',
        'robot.manipulator',
      ]);
    } finally {
      await runtime.close();
    }
  });

  it('rejects duplicate device ids', async () => {
    const runtime = await createHeterogeneousRuntime({ motionDelayMs: 0, includeChamber: false });
    try {
      await expect(
        runtime.registerFromModule('pinout/robot-arm', { id: ids.arm, simulated: true }),
      ).rejects.toBeInstanceOf(DuplicateDeviceError);
    } finally {
      await runtime.close();
    }
  });

  it('routes invoke to the correct device without cross-contamination', async () => {
    const runtime = await createHeterogeneousRuntime({ motionDelayMs: 0 });
    try {
      await runtime.invoke(ids.esp32, 'gpio.write', { pin: 2, value: true });
      const armPose = await runtime.invoke(ids.arm, 'pose.read', {});
      expect(armPose.position).toEqual({ x: 0, y: 0, z: 0 });

      await runtime.invoke(ids.chamber, 'temperature.set', { value: 30 });
      const chamber = await runtime.invoke(ids.chamber, 'temperature.read', {});
      expect(chamber.temperature).toBe(30);

      const esp32Read = await runtime.invoke(ids.esp32, 'gpio.read', { pin: 2 });
      expect(esp32Read.value).toBe(true);
    } finally {
      await runtime.close();
    }
  });

  it('multiplexes runtime events with deviceId envelope', async () => {
    const runtime = await createHeterogeneousRuntime({ motionDelayMs: 0 });
    const seen: string[] = [];
    runtime.on((event) => seen.push(`${event.deviceId}:${event.event}`));
    try {
      await runtime.invoke(ids.arm, 'gripper.close', {});
      expect(seen.some((entry) => entry === `${ids.arm}:gripper.changed`)).toBe(true);
    } finally {
      await runtime.close();
    }
  });

  it('denies unsafe chamber operations via policy', async () => {
    const runtime = await createHeterogeneousRuntime({ motionDelayMs: 0 });
    try {
      await expect(
        runtime.invoke(ids.chamber, 'temperature.set', { value: 200 }),
      ).rejects.toBeInstanceOf(PolicyConstraintViolation);

      await runtime.invoke(ids.chamber, 'door.open', {});
      await expect(runtime.invoke(ids.chamber, 'experiment.start', {})).rejects.toBeInstanceOf(
        PolicyPreconditionFailed,
      );
    } finally {
      await runtime.close();
    }
  });

  it('throws when invoking unknown device', async () => {
    const runtime = await createHeterogeneousRuntime({ motionDelayMs: 0 });
    try {
      await expect(runtime.invoke('missing', 'status.read', {})).rejects.toBeInstanceOf(
        DeviceNotFoundError,
      );
    } finally {
      await runtime.close();
    }
  });
});
