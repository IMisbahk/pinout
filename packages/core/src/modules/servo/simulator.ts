import { DeviceError } from '../../errors.js';
import type { DeviceBackend } from '../../runtime/types.js';

export type ServoOperationalStatus = 'ready' | 'moving' | 'faulted';

export interface ServoState {
  status: ServoOperationalStatus;
  angle: number;
}

export function createSimulatedServoBackend(): DeviceBackend {
  return new SimulatedServoBackend();
}

class SimulatedServoBackend implements DeviceBackend {
  readonly kind = 'simulated' as const;
  private state: ServoState = { status: 'ready', angle: 90 };
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
      throw new DeviceError('DISCONNECTED', 'Simulated servo is closed.');
    }
    if (this.state.status === 'faulted') {
      throw new DeviceError('DEVICE_FAULT', 'Servo is faulted.');
    }

    switch (action) {
      case 'servo.set_angle':
        return this.setAngle(requireNumber(payload.angle, 'angle'));
      case 'servo.read':
        return { angle: this.state.angle };
      case 'status.read':
        return { ...this.snapshotOperationalState() };
      default:
        throw new DeviceError('UNKNOWN_ACTION', `Unknown action '${action}'.`);
    }
  }

  private snapshotOperationalState(): Record<string, unknown> {
    return { status: this.state.status, angle: this.state.angle };
  }

  private setAngle(angle: number): Record<string, unknown> {
    this.state.angle = angle;
    this.state.status = 'ready';
    this.emit('servo.changed', { angle });
    return { angle };
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
