import { describe, expect, it } from 'vitest';
import { createSimulatedChamberBackend, createSimulatedRobotArmBackend } from '@pinout/core';

describe('simulated robot arm', () => {
  it('homes and moves within workspace', async () => {
    const arm = createSimulatedRobotArmBackend({ motionDelayMs: 0 });
    await arm.invoke('motion.home', {});
    const moved = await arm.invoke('motion.move_to', { x: 0.4, y: -0.1, z: 0.6 });
    expect(moved.position).toEqual({ x: 0.4, y: -0.1, z: 0.6 });
    await arm.close();
  });

  it('emits gripper.changed events', async () => {
    const arm = createSimulatedRobotArmBackend({ motionDelayMs: 0 });
    const events: string[] = [];
    arm.subscribe((event) => events.push(event));
    await arm.invoke('gripper.close', {});
    expect(events).toContain('gripper.changed');
    await arm.close();
  });
});

describe('simulated chamber', () => {
  it('tracks temperature changes', async () => {
    const chamber = createSimulatedChamberBackend();
    await chamber.invoke('temperature.set', { value: 40 });
    const reading = await chamber.invoke('temperature.read', {});
    expect(reading.temperature).toBe(40);
    await chamber.close();
  });

  it('allows experiment.start with open door at simulator layer', async () => {
    const chamber = createSimulatedChamberBackend();
    await chamber.invoke('door.open', {});
    await expect(chamber.invoke('experiment.start', {})).resolves.toEqual({
      experiment: 'running',
    });
    await chamber.close();
  });
});
