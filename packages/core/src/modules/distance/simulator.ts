import { DeviceError } from '../../errors.js';
import type { DeviceBackend } from '../../runtime/types.js';

export interface SimulatedDistanceOptions {
  meters?: number;
}

export function createSimulatedDistanceBackend(
  options: SimulatedDistanceOptions = {},
): DeviceBackend {
  return new SimulatedDistanceBackend(options.meters ?? 0.5);
}

class SimulatedDistanceBackend implements DeviceBackend {
  readonly kind = 'simulated' as const;
  private closed = false;
  private listeners = new Set<(event: string, payload: Record<string, unknown>) => void>();

  constructor(private meters: number) {}

  subscribe(handler: (event: string, payload: Record<string, unknown>) => void): () => void {
    this.listeners.add(handler);
    return () => this.listeners.delete(handler);
  }

  async close(): Promise<void> {
    this.closed = true;
    this.listeners.clear();
  }

  getOperationalState(): Record<string, unknown> {
    return { status: 'ready', meters: this.meters };
  }

  async invoke(action: string): Promise<Record<string, unknown>> {
    if (this.closed) {
      throw new DeviceError('DISCONNECTED', 'Simulated distance sensor is closed.');
    }
    if (action === 'distance.read') {
      return { meters: this.meters };
    }
    if (action === 'status.read') {
      return this.getOperationalState();
    }
    throw new DeviceError('UNKNOWN_ACTION', `Unknown action '${action}'.`);
  }
}
