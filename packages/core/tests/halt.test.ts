import { describe, expect, it, vi } from 'vitest';
import {
  HaltCoordinator,
  safetyStateEventName,
} from '../src/halt/haltCoordinator.js';

describe('HaltCoordinator', () => {
  it('starts NORMAL and permits invocations', () => {
    const halt = new HaltCoordinator();
    expect(halt.state).toBe('NORMAL');
    expect(halt.gate()).toEqual({ allowed: true });
  });

  it('rejects physical actions while halted and reports the reason', () => {
    const halt = new HaltCoordinator();
    halt.halt('maintenance mode engaged');
    expect(halt.state).toBe('HALTED');
    expect(halt.gate()).toMatchObject({ allowed: false, code: 'SAFETY_HALTED' });
    expect(() => halt.enforceGate()).toThrowError(/maintenance mode engaged/);
  });

  it('treats estop as sticky: clearEstop then resume are both required', () => {
    const halt = new HaltCoordinator();
    halt.requestEstop('operator pressed e-stop');
    expect(halt.state).toBe('ESTOP_REQUESTED');
    expect(halt.isEstopRequested).toBe(true);

    expect(() => halt.resume()).toThrowError(/clearEstop/);
    halt.clearEstop();
    expect(halt.state).toBe('HALTED');
    expect(halt.gate().allowed).toBe(false);
    halt.resume('operator confirmed safe');
    expect(halt.state).toBe('NORMAL');
    expect(halt.gate().allowed).toBe(true);
  });

  it('requires fault clearing before resume', () => {
    const halt = new HaltCoordinator();
    halt.fault('motor driver watchdog trip');
    expect(halt.state).toBe('FAULTED');
    expect(() => halt.resume()).toThrowError(/clearFault/);
    halt.clearFault();
    expect(halt.state).toBe('NORMAL');
  });

  it('supports restricted mode and resume', () => {
    const halt = new HaltCoordinator();
    halt.restrict('out-of-hours policy');
    expect(halt.gate().allowed).toBe(true);
    halt.resume();
    expect(halt.state).toBe('NORMAL');
  });

  it('emits audit state changes to subscribers', () => {
    const halt = new HaltCoordinator();
    const changes: string[] = [];
    halt.subscribe((change) => changes.push(`${change.from}->${change.to}`));
    halt.halt('a');
    halt.resume('b');
    expect(changes).toEqual(['NORMAL->HALTED', 'HALTED->NORMAL']);
  });

  it('forwards state changes to the onStateChange option with event names', () => {
    const onStateChange = vi.fn();
    const halt = new HaltCoordinator({ onStateChange });
    halt.halt('x');
    expect(onStateChange).toHaveBeenCalledTimes(1);
    const change = onStateChange.mock.calls[0][0];
    expect(change.from).toBe('NORMAL');
    expect(change.to).toBe('HALTED');
    expect(safetyStateEventName(change.to)).toBe('safety.halted');
    expect(safetyStateEventName('NORMAL')).toBe('safety.resumed');
  });

  it('resume from NORMAL is a no-op transition', () => {
    const halt = new HaltCoordinator();
    const changes: unknown[] = [];
    halt.subscribe((c) => changes.push(c));
    halt.resume();
    expect(changes).toHaveLength(0);
  });
});
