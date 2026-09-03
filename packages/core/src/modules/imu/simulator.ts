import { DeviceError } from '../../errors.js';
import type { DeviceBackend } from '../../runtime/types.js';

export interface ImuVector {
  x: number;
  y: number;
  z: number;
}

export function createSimulatedImuBackend(): DeviceBackend {
  return new SimulatedImuBackend();
}

class SimulatedImuBackend implements DeviceBackend {
  readonly kind = 'simulated' as const;
  private closed = false;
  private accel: ImuVector = { x: 0, y: 0, z: 1 };
  private gyro: ImuVector = { x: 0, y: 0, z: 0 };
  private listeners = new Set<(event: string, payload: Record<string, unknown>) => void>();

  subscribe(handler: (event: string, payload: Record<string, unknown>) => void): () => void {
    this.listeners.add(handler);
    return () => this.listeners.delete(handler);
  }

  async close(): Promise<void> {
    this.closed = true;
    this.listeners.clear();
  }

  getOperationalState(): Record<string, unknown> {
    return { status: 'ready', accel: { ...this.accel }, gyro: { ...this.gyro } };
  }

  async invoke(action: string): Promise<Record<string, unknown>> {
    if (this.closed) {
      throw new DeviceError('DISCONNECTED', 'Simulated IMU is closed.');
    }
    if (action === 'imu.read') {
      return { accel: { ...this.accel }, gyro: { ...this.gyro } };
    }
    if (action === 'status.read') {
      return this.getOperationalState();
    }
    throw new DeviceError('UNKNOWN_ACTION', `Unknown action '${action}'.`);
  }
}
