import { DeviceError } from '../../errors.js';
import type { DeviceBackend } from '../../runtime/types.js';

export interface SimulatedEncoderOptions {
  ticks?: number;
}

export function createSimulatedEncoderBackend(
  options: SimulatedEncoderOptions = {},
): DeviceBackend {
  return new SimulatedEncoderBackend(options.ticks ?? 0);
}

class SimulatedEncoderBackend implements DeviceBackend {
  readonly kind = 'simulated' as const;
  private closed = false;
  private listeners = new Set<(event: string, payload: Record<string, unknown>) => void>();

  constructor(private ticks: number) {}

  subscribe(handler: (event: string, payload: Record<string, unknown>) => void): () => void {
    this.listeners.add(handler);
    return () => this.listeners.delete(handler);
  }

  async close(): Promise<void> {
    this.closed = true;
    this.listeners.clear();
  }

  getOperationalState(): Record<string, unknown> {
    return { status: 'ready', ticks: this.ticks };
  }

  async invoke(action: string): Promise<Record<string, unknown>> {
    if (this.closed) {
      throw new DeviceError('DISCONNECTED', 'Simulated encoder is closed.');
    }
    if (action === 'encoder.read') {
      return { ticks: this.ticks };
    }
    if (action === 'encoder.reset') {
      this.ticks = 0;
      return { ticks: 0 };
    }
    if (action === 'status.read') {
      return this.getOperationalState();
    }
    throw new DeviceError('UNKNOWN_ACTION', `Unknown action '${action}'.`);
  }
}
