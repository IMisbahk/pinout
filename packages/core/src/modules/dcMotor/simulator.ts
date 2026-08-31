import { DeviceError } from '../../errors.js';
import type { DeviceBackend } from '../../runtime/types.js';

export type DcMotorOperationalStatus = 'ready' | 'running' | 'stopped' | 'faulted';

export interface DcMotorState {
  status: DcMotorOperationalStatus;
  speed: number;
}

export function createSimulatedDcMotorBackend(): DeviceBackend {
  return new SimulatedDcMotorBackend();
}

class SimulatedDcMotorBackend implements DeviceBackend {
  readonly kind = 'simulated' as const;
  private state: DcMotorState = { status: 'stopped', speed: 0 };
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
      throw new DeviceError('DISCONNECTED', 'Simulated DC motor is closed.');
    }
    if (this.state.status === 'faulted') {
      throw new DeviceError('DEVICE_FAULT', 'DC motor is faulted.');
    }

    switch (action) {
      case 'motor.set':
        return this.setSpeed(requireNumber(payload.speed, 'speed'));
      case 'motor.stop':
        return this.setSpeed(0);
      case 'motor.read':
        return { speed: this.state.speed };
      case 'status.read':
        return { ...this.snapshotOperationalState() };
      default:
        throw new DeviceError('UNKNOWN_ACTION', `Unknown action '${action}'.`);
    }
  }

  private snapshotOperationalState(): Record<string, unknown> {
    return { status: this.state.status, speed: this.state.speed };
  }

  private setSpeed(speed: number): Record<string, unknown> {
    this.state.speed = speed;
    this.state.status = speed === 0 ? 'stopped' : 'running';
    this.emit('motor.changed', { speed });
    return { speed };
  }

  private emit(event: string, payload: Record<string, unknown>): void {
    for (const listener of this.listeners) {
      listener(event, payload);
    }
  }
}

function requireNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new DeviceError('INVALID_PAYLOAD', `${field} must be a finite number.`);
  }
  return value;
}
