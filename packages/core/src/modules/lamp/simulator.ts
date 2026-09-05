import { DeviceError } from '../../errors.js';
import { createLogger } from '../../logger.js';
import {
  computeFreshness,
  recordAcknowledged,
  recordCommanded,
  recordObserved,
  unknownEvidence,
  type EvidenceState,
} from '../../spec/evidence.js';
import type { BackendInvocationContext, DeviceBackend } from '../../runtime/types.js';
import {
  validateLampConfig,
  type LampArmedState,
  type LampStatus,
  type ValidatedLampConfig,
} from './types.js';

export class SimulatedLampBackend implements DeviceBackend {
  readonly kind = 'simulated' as const;
  private readonly config: ValidatedLampConfig;
  private armedState: LampArmedState = 'disarmed';
  private onEvidence: EvidenceState<boolean>;
  private armedEvidence: EvidenceState<LampArmedState>;
  private simulatedReadbackLevel: boolean | undefined = undefined;
  private maxOnTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly listeners = new Set<(event: string, payload: Record<string, unknown>) => void>();
  private closed = false;

  constructor(options: Record<string, unknown> = {}) {
    this.config = validateLampConfig(options);
    this.onEvidence = unknownEvidence<boolean>(this.config.provenance);
    this.armedEvidence = unknownEvidence<LampArmedState>(this.config.provenance);

    if (this.config.autoArm) {
      createLogger('warn', { module: 'pinout:lamp' }).warn(
        'autoArm is enabled on simulated lamp backend; this is for demo/testing only and bypasses explicit arming safety.',
      );
      this.armedState = 'armed';
      this.armedEvidence = recordAcknowledged(
        this.armedEvidence,
        'armed',
        null,
        this.config.provenance,
      );
    } else {
      this.armedState = 'disarmed';
      this.armedEvidence = recordAcknowledged(
        this.armedEvidence,
        'disarmed',
        null,
        this.config.provenance,
      );
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

  getOperationalStateEvidence(): Record<string, EvidenceState<unknown>> {
    const now = Date.now();
    const freshOn = computeFreshness(this.onEvidence, now, this.config.observationMaxAgeMs);
    const freshArmed = computeFreshness(this.armedEvidence, now);
    return {
      on: freshOn as EvidenceState<unknown>,
      armed: freshArmed as EvidenceState<unknown>,
    };
  }

  async arm(options: { timeoutMs?: number } = {}): Promise<Record<string, unknown>> {
    const timeoutMs =
      typeof options.timeoutMs === 'number'
        ? options.timeoutMs
        : (this.config.watchdogTimeoutMs ?? 1000);
    this.armedState = 'armed';
    this.armedEvidence = recordAcknowledged(
      this.armedEvidence,
      'armed',
      null,
      this.config.provenance,
    );
    return { armed: 'armed', timeoutMs };
  }

  async disarm(): Promise<Record<string, unknown>> {
    this.clearMaxOnTimer();
    this.armedState = 'disarmed';
    this.armedEvidence = recordAcknowledged(
      this.armedEvidence,
      'disarmed',
      null,
      this.config.provenance,
    );
    if (this.config.readbackPin !== undefined) {
      this.simulatedReadbackLevel = this.config.polarity === 'active-low' ? true : false;
      const observedOn = false;
      this.onEvidence = recordObserved(
        this.onEvidence,
        observedOn,
        'simulated',
        null,
        this.config.provenance,
        this.config.observationMaxAgeMs,
      );
    }
    this.emit('safe_state.applied', { pin: this.config.pin, safeLevel: this.config.safeLevel });
    return { armed: 'disarmed' };
  }

  async safeState(): Promise<Record<string, unknown>> {
    this.clearMaxOnTimer();
    this.armedState = 'disarmed';
    this.armedEvidence = recordAcknowledged(
      this.armedEvidence,
      'disarmed',
      null,
      this.config.provenance,
    );
    this.emit('safe_state.applied', { pin: this.config.pin, safeLevel: this.config.safeLevel });
    return { applied: true, pin: this.config.pin, safeLevel: this.config.safeLevel };
  }

  injectTrip(reason = 'WATCHDOG_EXPIRED'): void {
    this.clearMaxOnTimer();
    this.armedState = 'tripped';
    this.armedEvidence = recordAcknowledged(
      this.armedEvidence,
      'tripped',
      null,
      this.config.provenance,
    );
    this.emit('device.tripped', { reason, stoppedPins: [this.config.pin] });
  }

  setSimulatedReadbackLevel(level: boolean): void {
    this.simulatedReadbackLevel = level;
    const observedOn = this.config.readbackPolarity === 'active-low' ? !level : level;
    this.onEvidence = recordObserved(
      this.onEvidence,
      observedOn,
      'simulated',
      null,
      this.config.provenance,
      this.config.observationMaxAgeMs,
    );
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

      const now = new Date();
      this.onEvidence = recordCommanded(this.onEvidence, targetOn, now, this.config.provenance);
      this.onEvidence = recordAcknowledged(this.onEvidence, targetOn, now, this.config.provenance);

      if (this.config.readbackPin !== undefined) {
        const physicalHigh = this.config.polarity === 'active-low' ? !targetOn : targetOn;
        this.simulatedReadbackLevel = physicalHigh;
        const observedOn =
          this.config.readbackPolarity === 'active-low' ? !physicalHigh : physicalHigh;
        this.onEvidence = recordObserved(
          this.onEvidence,
          observedOn,
          'simulated',
          now,
          this.config.provenance,
          this.config.observationMaxAgeMs,
        );
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
    const now = Date.now();
    const freshOn = computeFreshness(this.onEvidence, now, this.config.observationMaxAgeMs);
    const freshArmed = computeFreshness(this.armedEvidence, now);

    return {
      commanded: {
        value: freshOn.commanded.value,
        on: freshOn.commanded.value,
        at: freshOn.commanded.at,
        source: freshOn.commanded.source,
      },
      acknowledged: {
        value: freshOn.acknowledged.value,
        on: freshOn.acknowledged.value,
        at: freshOn.acknowledged.at,
        source: freshOn.acknowledged.source,
      },
      observed: {
        value: freshOn.observed.value,
        on: freshOn.observed.value,
        at: freshOn.observed.at,
        source: freshOn.observed.source,
      },
      freshnessMs: freshOn.freshnessMs,
      stale: freshOn.stale,
      provenance: freshOn.provenance,
      armed: this.armedState,
      evidence: {
        on: freshOn,
        armed: freshArmed,
      },
    };
  }

  private startMaxOnTimer(maxOnMs: number): void {
    this.clearMaxOnTimer();
    this.maxOnTimer = setTimeout(() => {
      const now = new Date();
      this.onEvidence = recordCommanded(this.onEvidence, false, now, this.config.provenance);
      this.onEvidence = recordAcknowledged(this.onEvidence, false, now, this.config.provenance);
      if (this.config.readbackPin !== undefined) {
        this.simulatedReadbackLevel = this.config.polarity === 'active-low' ? true : false;
        this.onEvidence = recordObserved(
          this.onEvidence,
          false,
          'simulated',
          now,
          this.config.provenance,
          this.config.observationMaxAgeMs,
        );
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
