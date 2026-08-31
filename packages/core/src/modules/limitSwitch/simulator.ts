import { DeviceError } from '../../errors.js';
import type { DeviceBackend } from '../../runtime/types.js';

export interface SimulatedLimitSwitchOptions {
  triggered?: boolean;
}

export function createSimulatedLimitSwitchBackend(
  options: SimulatedLimitSwitchOptions = {},
): DeviceBackend {
  return new SimulatedLimitSwitchBackend(options.triggered ?? false);
}

class SimulatedLimitSwitchBackend implements DeviceBackend {
  readonly kind = 'simulated' as const;
  private closed = false;
  private listeners = new Set<(event: string, payload: Record<string, unknown>) => void>();

  constructor(private triggered: boolean) {}

  subscribe(handler: (event: string, payload: Record<string, unknown>) => void): () => void {
    this.listeners.add(handler);
    return () => this.listeners.delete(handler);
  }

  async close(): Promise<void> {
    this.closed = true;
    this.listeners.clear();
  }

  getOperationalState(): Record<string, unknown> {
    return { status: 'ready', triggered: this.triggered };
  }

  async invoke(action: string): Promise<Record<string, unknown>> {
    if (this.closed) {
      throw new DeviceError('DISCONNECTED', 'Simulated limit switch is closed.');
    }
    if (action === 'limit.read') {
      return { triggered: this.triggered };
    }
    if (action === 'status.read') {
      return this.getOperationalState();
    }
    throw new DeviceError('UNKNOWN_ACTION', `Unknown action '${action}'.`);
  }
}
