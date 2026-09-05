import { DeviceError } from '../../errors.js';
import { createLogger } from '../../logger.js';
import type { BackendInvocationContext, DeviceBackend } from '../../runtime/types.js';
import {
  validateLampConfig,
  type LampArmedState,
  type LampCommandedState,
  type LampAcknowledgedState,
  type LampObservedState,
  type LampStatus,
  type ValidatedLampConfig,
} from './types.js';

export class SimulatedLampBackend implements DeviceBackend {
  readonly kind = 'simulated' as const;
  private readonly config: ValidatedLampConfig;
  private armedState: LampArmedState = 'disarmed';
  private commanded: LampCommandedState = { on: null, at: null };
  private acknowledged: LampAcknowledgedState = { on: null, at: null };
  private lastObserved: LampObservedState = { on: null, at: null, source: 'none' };
  private lastObservedTimestamp: number | null = null;
  private simulatedReadbackLevel: boolean | undefined = undefined;
  private maxOnTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly listeners = new Set<(event: string, payload: Record<string, unknown>) => void>();
  private closed = false;

  constructor(options: Record<string, unknown> = {}) {
    this.config = validateLampConfig(options);
    if (this.config.autoArm) {
      createLogger('warn', { module: 'pinout:lamp' }).warn(
        'autoArm is enabled on simulated lamp backend; this is for demo/testing only and bypasses explicit arming safety.',
      );
      this.armedState = 'armed';
    } else {
      this.armedState = 'disarmed';
    }
  }

  subscribe(handler: (event: string, payload: Record<string, unknown>) => void): () => void {
    this.listeners.add(handler);
    return () => this.listeners.delete(handler);
  }

  async close(): Promise<void> {
    this.closed = true;
    this.clearMaxOnTimer();
    this.listeners.clear();
  }

  getOperationalState(): Record<string, unknown> {
    return this.buildStatus();
  }

  async arm(options: { timeoutMs?: number } = {}): Promise<Record<string, unknown>> {
    const timeoutMs =
      typeof options.timeoutMs === 'number'
        ? options.timeoutMs
        : (this.config.watchdogTimeoutMs ?? 1000);
    this.armedState = 'armed';
    return { armed: 'armed', timeoutMs };
  }

  async disarm(): Promise<Record<string, unknown>> {
    this.clearMaxOnTimer();
    this.armedState = 'disarmed';
    if (this.config.readbackPin !== undefined) {
      this.simulatedReadbackLevel = this.config.polarity === 'active-low' ? true : false;
    }
    this.emit('safe_state.applied', { pin: this.config.pin, safeLevel: this.config.safeLevel });
    return { armed: 'disarmed' };
  }

  async safeState(): Promise<Record<string, unknown>> {
    this.clearMaxOnTimer();
    this.armedState = 'disarmed';
    this.emit('safe_state.applied', { pin: this.config.pin, safeLevel: this.config.safeLevel });
    return { applied: true, pin: this.config.pin, safeLevel: this.config.safeLevel };
  }

  injectTrip(reason = 'WATCHDOG_EXPIRED'): void {
    this.clearMaxOnTimer();
    this.armedState = 'tripped';
    this.emit('device.tripped', { reason, stoppedPins: [this.config.pin] });
  }

  setSimulatedReadbackLevel(level: boolean): void {
    this.simulatedReadbackLevel = level;
  }

  async invoke(
    action: string,
    payload: Record<string, unknown> = {},
    _context: BackendInvocationContext = {},
  ): Promise<Record<string, unknown>> {
    if (this.closed) {
      throw new DeviceError('DISCONNECTED', 'Simulated lamp backend is closed.');
    }

    if (action === 'lamp.status' || action === 'status.read') {
      return this.buildStatus();
    }

    if (action === 'lamp.arm') {
      const timeoutMs =
        typeof payload.timeoutMs === 'number'
          ? payload.timeoutMs
          : (this.config.watchdogTimeoutMs ?? 1000);
      return this.arm({ timeoutMs });
    }

    if (action === 'lamp.disarm') {
      return this.disarm();
    }

    if (action === 'lamp.on' || action === 'lamp.off' || action === 'lamp.set') {
      let targetOn: boolean;
      if (action === 'lamp.on') {
        targetOn = true;
      } else if (action === 'lamp.off') {
        targetOn = false;
      } else {
        targetOn = Boolean(payload.on);
      }

      if (this.armedState === 'disarmed') {
        throw new DeviceError(
          'NOT_ARMED',
          'Device is disarmed. Explicit arming (lamp.arm) is required before actuation.',
        );
      }
      if (this.armedState === 'tripped') {
        throw new DeviceError(
          'WATCHDOG_TRIPPED',
          'Device watchdog tripped. Re-arming (lamp.arm) is required before actuation.',
        );
      }

      const nowIso = new Date().toISOString();
      this.commanded = { on: targetOn, at: nowIso };
      this.acknowledged = { on: targetOn, at: nowIso };

      if (this.config.readbackPin !== undefined) {
        const physicalHigh = this.config.polarity === 'active-low' ? !targetOn : targetOn;
        this.simulatedReadbackLevel = physicalHigh;
      }

      if (targetOn && this.config.maxOnMs) {
        this.startMaxOnTimer(this.config.maxOnMs);
      } else {
        this.clearMaxOnTimer();
      }

      this.emit('lamp.changed', { on: targetOn });
      return { on: targetOn };
    }

    throw new DeviceError('UNKNOWN_ACTION', `Unknown action '${action}'.`);
  }

  private buildStatus(): LampStatus {
    if (this.config.readbackPin !== undefined) {
      const defaultPhysical =
        this.config.polarity === 'active-low'
          ? !this.acknowledged.on
          : Boolean(this.acknowledged.on);
      const rawLevel = this.simulatedReadbackLevel ?? defaultPhysical;
      const observedOn = this.config.readbackPolarity === 'active-low' ? !rawLevel : rawLevel;
      const atIso = new Date().toISOString();
      this.lastObserved = { on: observedOn, at: atIso, source: 'simulated' };
      this.lastObservedTimestamp = Date.now();
    } else {
      this.lastObserved = { on: null, at: null, source: 'none' };
      this.lastObservedTimestamp = null;
    }

    const freshnessMs = this.lastObservedTimestamp !== null ? 0 : null;

    return {
      commanded: { ...this.commanded },
      acknowledged: { ...this.acknowledged },
      observed: { ...this.lastObserved },
      freshnessMs,
      provenance: 'simulated',
      armed: this.armedState,
    };
  }

  private startMaxOnTimer(maxOnMs: number): void {
    this.clearMaxOnTimer();
    this.maxOnTimer = setTimeout(() => {
      const nowIso = new Date().toISOString();
      this.commanded = { on: false, at: nowIso };
      this.acknowledged = { on: false, at: nowIso };
      if (this.config.readbackPin !== undefined) {
        this.simulatedReadbackLevel = this.config.polarity === 'active-low' ? true : false;
      }
      this.emit('lamp.changed', { on: false, reason: 'max_on_exceeded' });
    }, maxOnMs);
  }

  private clearMaxOnTimer(): void {
    if (this.maxOnTimer) {
      clearTimeout(this.maxOnTimer);
      this.maxOnTimer = undefined;
    }
  }

  private emit(event: string, payload: Record<string, unknown>): void {
    for (const listener of this.listeners) {
      listener(event, payload);
    }
  }
}

export function createSimulatedLampBackend(options: Record<string, unknown> = {}): DeviceBackend {
  return new SimulatedLampBackend(options);
}
