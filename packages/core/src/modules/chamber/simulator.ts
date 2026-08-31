import { DeviceError } from '../../errors.js';
import type { DeviceBackend } from '../../runtime/types.js';

export type ChamberDoor = 'open' | 'closed';
export type ChamberExperiment = 'idle' | 'running';
export type ChamberOperationalStatus = 'ready' | 'busy' | 'faulted';

export interface ChamberState {
  status: ChamberOperationalStatus;
  temperature: number;
  targetTemperature: number;
  door: ChamberDoor;
  experiment: ChamberExperiment;
}

export function createSimulatedChamberBackend(): DeviceBackend {
  return new SimulatedChamberBackend();
}

class SimulatedChamberBackend implements DeviceBackend {
  readonly kind = 'simulated' as const;
  private state: ChamberState = {
    status: 'ready',
    temperature: 22,
    targetTemperature: 22,
    door: 'closed',
    experiment: 'idle',
  };
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
      throw new DeviceError('DISCONNECTED', 'Simulated chamber is closed.');
    }
    if (this.state.status === 'faulted') {
      throw new DeviceError('DEVICE_FAULT', 'Chamber is faulted.');
    }

    switch (action) {
      case 'temperature.read':
        return {
          temperature: this.state.temperature,
          targetTemperature: this.state.targetTemperature,
        };
      case 'temperature.set': {
        const value = requireNumber(payload.value, 'value');
        this.state.targetTemperature = value;
        this.state.temperature = value;
        this.emit('temperature.changed', {
          temperature: this.state.temperature,
          targetTemperature: this.state.targetTemperature,
        });
        return { targetTemperature: this.state.targetTemperature };
      }
      case 'door.open':
        return this.setDoor('open');
      case 'door.close':
        return this.setDoor('closed');
      case 'experiment.start':
        return this.startExperiment();
      case 'experiment.stop':
        return this.stopExperiment();
      case 'status.read':
        return { ...this.snapshotOperationalState() };
      default:
        throw new DeviceError('UNKNOWN_ACTION', `Unknown action '${action}'.`);
    }
  }

  private snapshotOperationalState(): Record<string, unknown> {
    return {
      status: this.state.status,
      temperature: this.state.temperature,
      targetTemperature: this.state.targetTemperature,
      door: this.state.door,
      experiment: this.state.experiment,
    };
  }

  private setDoor(door: ChamberDoor): Record<string, unknown> {
    this.state.door = door;
    this.emit('door.changed', { door });
    return { door };
  }

  private startExperiment(): Record<string, unknown> {
    this.state.status = 'busy';
    this.state.experiment = 'running';
    this.emit('experiment.started', {
      targetTemperature: this.state.targetTemperature,
      temperature: this.state.temperature,
    });
    this.state.status = 'ready';
    return { experiment: 'running' };
  }

  private stopExperiment(): Record<string, unknown> {
    this.state.experiment = 'idle';
    this.emit('experiment.stopped', { experiment: 'idle' });
    return { experiment: 'idle' };
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
