import { DeviceError } from '../../errors.js';
import type { DeviceBackend } from '../../runtime/types.js';

export type CoffeeWaterState = 'ok' | 'low';
export interface CoffeeSimulatorOptions {
  waterLevel?: CoffeeWaterState;
  temperature?: number;
  brewDurationMs?: number;
  now?: () => number;
}
export interface CoffeeMachineState {
  status: 'ready' | 'brewing' | 'faulted';
  water_level: { state: CoffeeWaterState };
  temperature: number;
  heater: boolean;
  pump: 'off' | 'running';
  brew: {
    status: 'idle' | 'brewing' | 'completed' | 'cancelled' | 'failed';
    progress: number;
    shots?: number;
    reason?: string;
  };
}

export class SimulatedCoffeeMachineBackend implements DeviceBackend {
  readonly kind = 'simulated' as const;
  private closed = false;
  private readonly listeners = new Set<(event: string, payload: Record<string, unknown>) => void>();
  private readonly now: () => number;
  private readonly duration: number;
  private startedAt = 0;
  private timer: ReturnType<typeof setInterval> | undefined;
  private state: CoffeeMachineState;
  constructor(options: CoffeeSimulatorOptions = {}) {
    this.now = options.now ?? Date.now;
    this.duration = options.brewDurationMs ?? 30_000;
    this.state = {
      status: 'ready',
      water_level: { state: options.waterLevel ?? 'ok' },
      temperature: options.temperature ?? 20,
      heater: false,
      pump: 'off',
      brew: { status: 'idle', progress: 0 },
    };
  }
  subscribe(handler: (event: string, payload: Record<string, unknown>) => void): () => void {
    this.listeners.add(handler);
    return () => this.listeners.delete(handler);
  }
  async close(): Promise<void> {
    this.closed = true;
    this.clearTimer();
    this.safeState();
    this.listeners.clear();
  }
  getOperationalState(): Record<string, unknown> {
    return this.snapshot();
  }
  async safeState(): Promise<Record<string, unknown>> {
    this.clearTimer();
    this.state.pump = 'off';
    this.state.heater = false;
    if (this.state.brew.status === 'brewing')
      this.state.brew = { ...this.state.brew, status: 'cancelled', reason: 'safe_state' };
    this.state.status = 'ready';
    this.emit('safe_state.applied', { pump: 'off', heater: false });
    return { pump: 'off', heater: false };
  }
  async invoke(action: string, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (this.closed) throw new DeviceError('DISCONNECTED', 'Simulated coffee machine is closed.');
    if (this.state.status === 'faulted')
      throw new DeviceError('DEVICE_FAULT', 'Coffee machine is faulted.');
    switch (action) {
      case 'water_level.read':
        return { ...this.state.water_level };
      case 'temperature.read':
        return { temperature: this.state.temperature };
      case 'status.read':
        return this.snapshot();
      case 'heater.set':
        if (payload.enabled === true && this.state.water_level.state !== 'ok')
          throw new DeviceError('INTERLOCK_OPEN', 'heater.set requires water_level.state == ok.');
        this.state.heater = payload.enabled === true;
        this.emit('heater.changed', { enabled: this.state.heater });
        return { enabled: this.state.heater };
      case 'pump.start':
        if (this.state.water_level.state !== 'ok')
          throw new DeviceError('INTERLOCK_OPEN', 'pump.start requires water_level.state == ok.');
        this.state.pump = 'running';
        this.emit('pump.changed', { pump: 'running' });
        return { pump: 'running' };
      case 'pump.stop':
        this.stopPump();
        return { pump: 'off' };
      case 'brew.start':
        return this.startBrew(typeof payload.shots === 'number' ? payload.shots : 1);
      case 'brew.stop':
        await this.safeState();
        this.state.brew.status = 'cancelled';
        this.state.brew.reason = 'operator';
        return { status: 'cancelled', pump: 'off', heater: this.state.heater };
      default:
        throw new DeviceError('UNKNOWN_ACTION', `Unknown action '${action}'.`);
    }
  }
  /** Advance deterministic time in tests; production uses the interval clock. */
  advance(ms: number): void {
    if (this.state.brew.status !== 'brewing') return;
    const fraction = Math.min(1, Math.max(0, (this.now() - this.startedAt + ms) / this.duration));
    this.state.brew.progress = fraction;
    this.emit('brew.progress', { progress: fraction });
    if (fraction >= 1) {
      this.clearTimer();
      this.stopPump();
      this.state.brew.status = 'completed';
      this.state.status = 'ready';
      this.emit('brew.completed', { progress: 1 });
    }
  }
  injectFault(reason = 'injected'): void {
    this.clearTimer();
    this.state.status = 'faulted';
    this.state.brew = {
      ...this.state.brew,
      status: this.state.brew.status === 'brewing' ? 'failed' : this.state.brew.status,
      reason,
    };
    this.stopPump();
    this.state.heater = false;
    this.emit('faulted', { reason });
  }
  private startBrew(shots: number): Record<string, unknown> {
    if (this.state.water_level.state !== 'ok')
      throw new DeviceError('INTERLOCK_OPEN', 'brew.start requires water_level.state == ok.');
    if (this.state.brew.status === 'brewing')
      throw new DeviceError('BUSY', 'A brew is already running.');
    this.startedAt = this.now();
    this.state.status = 'brewing';
    this.state.pump = 'running';
    this.state.brew = { status: 'brewing', progress: 0, shots };
    this.timer = setInterval(() => this.advance(0), 100);
    this.emit('brew.started', { shots });
    return { status: 'brewing', progress: 0 };
  }
  private stopPump(): void {
    this.state.pump = 'off';
    this.emit('pump.changed', { pump: 'off' });
  }
  private clearTimer(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }
  private snapshot(): Record<string, unknown> {
    return JSON.parse(JSON.stringify(this.state)) as Record<string, unknown>;
  }
  private emit(event: string, payload: Record<string, unknown>): void {
    for (const listener of this.listeners) listener(event, payload);
  }
}
export const createSimulatedCoffeeMachineBackend = (options: CoffeeSimulatorOptions = {}) =>
  new SimulatedCoffeeMachineBackend(options);
