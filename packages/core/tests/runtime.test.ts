import { describe, expect, it } from 'vitest';
import {
  DuplicateDeviceError,
  DeviceNotFoundError,
  PinoutRuntime,
  relayModule,
  PolicyConstraintViolation,
  PolicyPreconditionFailed,
  createHeterogeneousRuntime,
  defaultHeterogeneousDeviceIds,
  HaltCoordinator,
  SafetyEngine,
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
      expect(devices.find((device) => device.id === ids.esp32)).toMatchObject({
        activeTransportKind: 'simulated-esp32',
        simulated: true,
      });
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

  it('blocks module devices through the runtime halt gate', async () => {
    const runtime = await createHeterogeneousRuntime({ motionDelayMs: 0 });
    try {
      // The runtime owns the coordinator used by all module-created devices.
      expect(runtime.halt).toBeDefined();
      runtime.halt.halt('operator requested halt');
      await expect(
        runtime.invoke(ids.esp32, 'gpio.write', { pin: 2, value: true }),
      ).rejects.toThrow(/operator requested halt/i);
    } finally {
      await runtime.close();
    }
  });

  it('drives ESP32 backends to their safe state on halt', async () => {
    const runtime = await createHeterogeneousRuntime({
      motionDelayMs: 0,
      includeArm: false,
      includeChamber: false,
    });
    const safeStateEvents: Array<Record<string, unknown>> = [];
    runtime.on((event) => {
      if (event.deviceId === ids.esp32 && event.event === 'device.safe_state_applied') {
        safeStateEvents.push(event.payload);
      }
    });
    try {
      await runtime.invoke(ids.esp32, 'gpio.mode', { pin: 2, mode: 'output' });
      await runtime.invoke(ids.esp32, 'gpio.write', { pin: 2, value: true });
      runtime.halt.halt('safe state test');
      await runtime.waitForSafeState();
      expect(safeStateEvents).toEqual([{ applied: true, stoppedPins: [2] }]);
    } finally {
      await runtime.close();
    }
  });

  it('uses injected governance for registered devices', async () => {
    const halt = new HaltCoordinator();
    const safetyEngine = new SafetyEngine({ rules: [] });
    const runtime = new PinoutRuntime({ halt, safetyEngine });
    try {
      const device = await runtime.registerModuleDevice(relayModule, {
        id: 'esp-injected',
        simulated: true,
      });
      expect(runtime.halt).toBe(halt);
      expect(runtime.safetyEngine).toBe(safetyEngine);
      halt.halt('injected halt');
      await expect(device.invoke('relay.set', { on: true })).rejects.toThrow(/injected halt/i);
    } finally {
      await runtime.close();
    }
  });

  it('journals requested, completed, and failed runtime invocations', async () => {
    const runtime = await createHeterogeneousRuntime({
      motionDelayMs: 0,
      includeArm: false,
      includeChamber: false,
    });
    try {
      await runtime.invoke(ids.esp32, 'gpio.read', { pin: 2 });
      await expect(runtime.invoke(ids.esp32, 'not.a.capability', {})).rejects.toBeDefined();
      const entries = await runtime.journal.query({ deviceId: ids.esp32 });
      expect(entries.map((entry) => entry.kind)).toEqual([
        'invocation.requested',
        'invocation.completed',
        'invocation.requested',
        'invocation.failed',
      ]);
    } finally {
      await runtime.close();
    }
  });
});
