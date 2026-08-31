import { DeviceError } from '../../errors.js';
import type { DeviceBackend } from '../../runtime/types.js';

export type MobileBaseOperationalStatus = 'ready' | 'moving' | 'stopped' | 'faulted';

export interface SimulatedMobileBaseOptions {
  integrationDt?: number;
}

export function createSimulatedMobileBaseBackend(
  options: SimulatedMobileBaseOptions = {},
): DeviceBackend {
  return new SimulatedMobileBaseBackend(options.integrationDt ?? 0.1);
}

class SimulatedMobileBaseBackend implements DeviceBackend {
  readonly kind = 'simulated' as const;
  private status: MobileBaseOperationalStatus = 'stopped';
  private linear = 0;
  private angular = 0;
  private x = 0;
  private y = 0;
  private heading = 0;
  private closed = false;
  private listeners = new Set<(event: string, payload: Record<string, unknown>) => void>();

  constructor(private readonly integrationDt: number) {}

  subscribe(handler: (event: string, payload: Record<string, unknown>) => void): () => void {
    this.listeners.add(handler);
    return () => this.listeners.delete(handler);
  }

  async close(): Promise<void> {
    this.closed = true;
    this.listeners.clear();
  }

  getOperationalState(): Record<string, unknown> {
    return {
      status: this.status,
      linear: this.linear,
      angular: this.angular,
      x: this.x,
      y: this.y,
      heading: this.heading,
    };
  }

  async invoke(action: string, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (this.closed) {
      throw new DeviceError('DISCONNECTED', 'Simulated mobile base is closed.');
    }
    if (this.status === 'faulted') {
      throw new DeviceError('DEVICE_FAULT', 'Mobile base is faulted.');
    }

    switch (action) {
      case 'drive.set_velocity':
        return this.setVelocity(
          requireNumber(payload.linear, 'linear'),
          requireNumber(payload.angular, 'angular'),
        );
      case 'drive.stop':
        return this.setVelocity(0, 0);
      case 'pose.read':
        return { x: this.x, y: this.y, heading: this.heading };
      case 'status.read':
        return this.getOperationalState();
      default:
        throw new DeviceError('UNKNOWN_ACTION', `Unknown action '${action}'.`);
    }
  }

  private setVelocity(linear: number, angular: number): Record<string, unknown> {
    this.x += linear * Math.cos(this.heading) * this.integrationDt;
    this.y += linear * Math.sin(this.heading) * this.integrationDt;
    this.heading += angular * this.integrationDt;
    this.linear = linear;
    this.angular = angular;
    this.status = linear === 0 && angular === 0 ? 'stopped' : 'moving';
    this.emit('drive.changed', { linear, angular, x: this.x, y: this.y, heading: this.heading });
    return { linear, angular };
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
