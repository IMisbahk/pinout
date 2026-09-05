import { describe, expect, it } from 'vitest';
import {
  HaltCoordinator,
  OperationManager,
  PinoutRuntime,
  relayModule,
  registerModule,
} from '../src/index.js';

const tick = (ms = 5) => new Promise((resolve) => setTimeout(resolve, ms));

describe('Recovery: Halt and E-Stop Guarantees', () => {
  it('leaves in-flight operation in a terminal state when halt is requested and rejects new actuation', async () => {
    const halt = new HaltCoordinator();
    const runtime = new PinoutRuntime({ halt });
    registerModule(relayModule);
    await runtime.registerFromModule(relayModule.id, {
      id: 'relay-halt-test',
      simulated: true,
    });

    const manager = new OperationManager();

    // In-flight long-running operation
    const op = manager.begin({
      deviceId: 'relay-halt-test',
      capability: 'relay.set',
      run: async (ctx) => {
        while (!ctx.cancellationRequested()) {
          await tick(5);
        }
        ctx.throwIfCancelled();
        return {};
      },
    });

    await tick(10);
    expect(op.handle.snapshot().status).toBe('running');

    // Operator triggers software halt
    halt.halt('Safety barrier breached by operator');
    expect(halt.state).toBe('HALTED');

    // Cancel in-flight operation
    const terminalSnapshot = await op.handle.cancel('Runtime entered HALTED state');
    expect(terminalSnapshot.status).toBe('cancelled');
    expect(terminalSnapshot.error?.code).toBe('OPERATION_CANCELLED');

    // New physical actuation is strictly rejected
    await expect(
      runtime.invoke('relay-halt-test', 'relay.set', { on: true }),
    ).rejects.toMatchObject({
      code: 'SAFETY_HALTED',
    });

    // Operation manager begin() for physical actuation also rejected if checked
    expect(() => halt.enforceGate()).toThrowError(/Safety barrier breached/);

    // Resuming brings system back to NORMAL and permits actuation
    halt.resume('Safety barrier cleared');
    expect(halt.state).toBe('NORMAL');

    await expect(
      runtime.invoke('relay-halt-test', 'relay.set', { on: true }),
    ).resolves.toBeDefined();

    await runtime.close();
  });

  it('emergency stop (estop) latches and requires two-step clearEstop then resume', async () => {
    const halt = new HaltCoordinator();
    const runtime = new PinoutRuntime({ halt });
    registerModule(relayModule);
    await runtime.registerFromModule(relayModule.id, {
      id: 'relay-estop-test',
      simulated: true,
    });

    halt.requestEstop('Physical E-stop button depressed');
    expect(halt.state).toBe('ESTOP_REQUESTED');

    // Attempting to resume directly without clearEstop fails
    expect(() => halt.resume()).toThrowError(/clearEstop/);

    // Physical actuation rejected with SAFETY_ESTOP_REQUESTED
    await expect(
      runtime.invoke('relay-estop-test', 'relay.set', { on: true }),
    ).rejects.toMatchObject({
      code: 'SAFETY_ESTOP_REQUESTED',
    });

    // Step 1: Clear estop flag -> transitions to HALTED
    halt.clearEstop();
    expect(halt.state).toBe('HALTED');

    // Still cannot actuate while HALTED
    await expect(
      runtime.invoke('relay-estop-test', 'relay.set', { on: true }),
    ).rejects.toMatchObject({
      code: 'SAFETY_HALTED',
    });

    // Step 2: Explicit resume -> transitions to NORMAL
    halt.resume('Physical interlocks verified safe');
    expect(halt.state).toBe('NORMAL');

    await expect(
      runtime.invoke('relay-estop-test', 'relay.set', { on: true }),
    ).resolves.toBeDefined();

    await runtime.close();
  });
});
