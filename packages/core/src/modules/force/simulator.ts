import { DeviceError } from '../../errors.js';
import type { DeviceBackend } from '../../runtime/types.js';

export interface SimulatedForceOptions {
  newtons?: number;
}

export function createSimulatedForceBackend(options: SimulatedForceOptions = {}): DeviceBackend {
  return new SimulatedForceBackend(options.newtons ?? 0);
}

class SimulatedForceBackend implements DeviceBackend {
  readonly kind = 'simulated' as const;
  private closed = false;
  private listeners = new Set<(event: string, payload: Record<string, unknown>) => void>();

  constructor(private newtons: number) {}

  subscribe(handler: (event: string, payload: Record<string, unknown>) => void): () => void {
    this.listeners.add(handler);
    return () => this.listeners.delete(handler);
  }

  async close(): Promise<void> {
    this.closed = true;
    this.listeners.clear();
  }

  getOperationalState(): Record<string, unknown> {
    return { status: 'ready', newtons: this.newtons };
  }

  async invoke(action: string): Promise<Record<string, unknown>> {
    if (this.closed) {
      throw new DeviceError('DISCONNECTED', 'Simulated force sensor is closed.');
    }
    if (action === 'force.read') {
      return { newtons: this.newtons };
    }
    if (action === 'status.read') {
      return this.getOperationalState();
    }
    throw new DeviceError('UNKNOWN_ACTION', `Unknown action '${action}'.`);
  }
}
