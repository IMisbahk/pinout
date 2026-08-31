import { DeviceError } from '../../errors.js';
import type { DeviceBackend } from '../../runtime/types.js';

export type StepperOperationalStatus = 'ready' | 'busy' | 'stopped' | 'faulted';

export interface StepperState {
  status: StepperOperationalStatus;
  position: number;
  homed: boolean;
}

export function createSimulatedStepperBackend(): DeviceBackend {
  return new SimulatedStepperBackend();
}

class SimulatedStepperBackend implements DeviceBackend {
  readonly kind = 'simulated' as const;
  private state: StepperState = { status: 'ready', position: 0, homed: true };
  private listeners = new Set<(event: string, payload: Record<string, unknown>) => void>();
  private closed = false;

  subscribe(handler: (event: string, payload: Record<string, unknown>) => void): () => void {
    this.listeners.add(handler);
    return () => this.listeners.delete(handler);
  }

  async close(): Promise<void> {
    this.closed = true;
    this.listeners.clear();
  }

  getOperationalState(): Record<string, unknown> {
    return this.snapshotOperationalState();
  }

  async invoke(action: string, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (this.closed) {
      throw new DeviceError('DISCONNECTED', 'Simulated stepper is closed.');
    }
    if (this.state.status === 'faulted') {
      throw new DeviceError('DEVICE_FAULT', 'Stepper is faulted.');
    }

    switch (action) {
      case 'stepper.step':
        return this.moveTo(this.state.position + requireInteger(payload.steps, 'steps'));
      case 'stepper.goto':
        return this.moveTo(requireInteger(payload.position, 'position'));
      case 'stepper.home':
        this.state.homed = true;
        return this.moveTo(0);
      case 'stepper.stop':
        this.state.status = 'ready';
        this.emit('stepper.stopped', { position: this.state.position });
        return { status: 'stopped', position: this.state.position };
      case 'stepper.read':
        return { position: this.state.position, homed: this.state.homed };
      case 'status.read':
        return { ...this.snapshotOperationalState() };
      default:
        throw new DeviceError('UNKNOWN_ACTION', `Unknown action '${action}'.`);
    }
  }

  private snapshotOperationalState(): Record<string, unknown> {
    return {
      status: this.state.status,
      position: this.state.position,
      homed: this.state.homed,
    };
  }

  private moveTo(position: number): Record<string, unknown> {
    this.state.position = position;
    this.state.status = 'ready';
    this.emit('stepper.moved', { position });
    return { position, homed: this.state.homed };
  }

  private emit(event: string, payload: Record<string, unknown>): void {
    for (const listener of this.listeners) {
      listener(event, payload);
    }
  }
}

function requireInteger(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new DeviceError('INVALID_PAYLOAD', `${field} must be an integer.`);
  }
  return value;
}
