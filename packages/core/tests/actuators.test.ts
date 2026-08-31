import { describe, expect, it } from 'vitest';
import {
  PinoutRuntime,
  PolicyConstraintViolation,
  createSimulatedDcMotorBackend,
  createSimulatedServoBackend,
  createSimulatedStepperBackend,
  dcMotorModuleId,
  listAvailableModules,
  servoModuleId,
  stepperModuleId,
} from '@pinout/core';

describe('simulated DC motor', () => {
  it('sets speed and stops', async () => {
    const motor = createSimulatedDcMotorBackend();
    await motor.invoke('motor.set', { speed: 0.4 });
    expect(await motor.invoke('motor.read', {})).toEqual({ speed: 0.4 });
    await motor.invoke('motor.stop', {});
    expect(await motor.invoke('motor.read', {})).toEqual({ speed: 0 });
    await motor.close();
  });

  it('emits motor.changed', async () => {
    const motor = createSimulatedDcMotorBackend();
    const events: string[] = [];
    motor.subscribe((event) => events.push(event));
    await motor.invoke('motor.set', { speed: -0.2 });
    expect(events).toContain('motor.changed');
    await motor.close();
  });
});

describe('simulated servo', () => {
  it('moves to a commanded angle', async () => {
    const servo = createSimulatedServoBackend();
    expect(await servo.invoke('servo.set_angle', { angle: 45 })).toEqual({ angle: 45 });
    expect(await servo.invoke('servo.read', {})).toEqual({ angle: 45 });
    await servo.close();
  });
});

describe('simulated stepper', () => {
  it('steps relatively and homes', async () => {
    const stepper = createSimulatedStepperBackend();
    await stepper.invoke('stepper.step', { steps: 200 });
    expect(await stepper.invoke('stepper.read', {})).toEqual({ position: 200, homed: true });
    await stepper.invoke('stepper.home', {});
    expect(await stepper.invoke('stepper.read', {})).toEqual({ position: 0, homed: true });
    await stepper.close();
  });

  it('goes to an absolute position', async () => {
    const stepper = createSimulatedStepperBackend();
    expect(await stepper.invoke('stepper.goto', { position: -40 })).toEqual({
      position: -40,
      homed: true,
    });
    await stepper.close();
  });
});

describe('actuator modules in runtime', () => {
  it('lists first-party actuator modules', () => {
    const ids = listAvailableModules().map((entry) => entry.id);
    expect(ids).toEqual(expect.arrayContaining([dcMotorModuleId, servoModuleId, stepperModuleId]));
  });

  it('enforces motor speed policy', async () => {
    const runtime = new PinoutRuntime();
    await runtime.registerFromModule(dcMotorModuleId, { id: 'motor-01', simulated: true });
    try {
      await runtime.invoke('motor-01', 'motor.set', { speed: 0.5 });
      await expect(runtime.invoke('motor-01', 'motor.set', { speed: 2 })).rejects.toBeInstanceOf(
        PolicyConstraintViolation,
      );
    } finally {
      await runtime.close();
    }
  });

  it('enforces servo angle policy', async () => {
    const runtime = new PinoutRuntime();
    await runtime.registerFromModule(servoModuleId, { id: 'servo-01', simulated: true });
    try {
      await runtime.invoke('servo-01', 'servo.set_angle', { angle: 90 });
      await expect(
        runtime.invoke('servo-01', 'servo.set_angle', { angle: 270 }),
      ).rejects.toBeInstanceOf(PolicyConstraintViolation);
    } finally {
      await runtime.close();
    }
  });
});
