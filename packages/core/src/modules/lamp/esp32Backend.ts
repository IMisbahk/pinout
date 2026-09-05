import { connect } from '../../connect.js';
import { DeviceError } from '../../errors.js';
import { createLogger } from '../../logger.js';
import { simulatedEsp32 } from '../../drivers/esp32/simulatedTransport.js';
import { ProtocolDeviceBackend } from '../../runtime/protocolBackend.js';
import {
  computeFreshness,
  recordAcknowledged,
  recordCommanded,
  recordObserved,
  unknownEvidence,
  type EvidenceProvenance,
  type EvidenceState,
} from '../../spec/evidence.js';
import type { BackendInvocationContext, DeviceBackend } from '../../runtime/types.js';
import type { Device } from '../../device.js';
import type { Transport } from '../../types.js';
import {
  validateLampConfig,
  type LampArmedState,
  type LampStatus,
  type ValidatedLampConfig,
} from './types.js';

export class Esp32LampBackend implements DeviceBackend {
  readonly kind = 'protocol' as const;
  private readonly device: Device;
  private readonly protocolBackend: ProtocolDeviceBackend;
  private readonly config: ValidatedLampConfig;
  private onEvidence: EvidenceState<boolean>;
  private armedEvidence: EvidenceState<LampArmedState>;
  private maxOnTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly listeners = new Set<(event: string, payload: Record<string, unknown>) => void>();
  private closed = false;

  private constructor(
    device: Device,
    protocolBackend: ProtocolDeviceBackend,
    config: ValidatedLampConfig,
  ) {
    this.device = device;
    this.protocolBackend = protocolBackend;
    this.config = config;
    this.onEvidence = unknownEvidence<boolean>(this.config.provenance);
    this.armedEvidence = unknownEvidence<LampArmedState>(this.config.provenance);
    this.armedEvidence = recordAcknowledged(
      this.armedEvidence,
      this.config.autoArm ? 'armed' : 'disarmed',
      null,
      this.config.provenance,
    );

    this.device.on('device.tripped', (payload) => {
      this.clearMaxOnTimer();
      this.armedEvidence = recordAcknowledged(
        this.armedEvidence,
        'tripped',
        null,
        this.config.provenance,
      );
      this.emit('device.tripped', payload);
    });
  }

  static async create(options: Record<string, unknown> = {}): Promise<Esp32LampBackend> {
    const config = validateLampConfig(options);
    if (config.autoArm) {
      createLogger('warn', { module: 'pinout:lamp' }).warn(
        'autoArm is enabled on lamp backend; this is for demo/testing only and bypasses explicit arming safety.',
      );
    }
    const transport =
      (config.transport as Transport | undefined) ??
      (options.transport as Transport | undefined) ??
      simulatedEsp32();
    const device = (config.device as Device | undefined) ?? (await connect({ transport }));

    const protocolBackend = new ProtocolDeviceBackend(device, {
      outputs: [{ pin: config.pin, safeLevel: config.safeLevel, polarity: config.polarity }],
      requireWatchdog: config.requireWatchdog,
      autoHeartbeat: config.autoHeartbeat,
      heartbeatIntervalMs: config.heartbeatIntervalMs,
      watchdogTimeoutMs: config.watchdogTimeoutMs,
      autoArm: config.autoArm,
    });

    if (config.readbackPin !== undefined && device.supports('gpio.mode')) {
      await device.gpio.mode(config.readbackPin, 'input').catch(() => undefined);
    }

    if (config.autoArm) {
      await protocolBackend.arm({
        timeoutMs: config.watchdogTimeoutMs,
        heartbeatIntervalMs: config.heartbeatIntervalMs,
        requireWatchdog: config.requireWatchdog,
      });
    } else {
      await protocolBackend.initializeOutputs();
    }

    return new Esp32LampBackend(device, protocolBackend, config);
  }

  subscribe(handler: (event: string, payload: Record<string, unknown>) => void): () => void {
    this.listeners.add(handler);
    return () => this.listeners.delete(handler);
  }

  async close(): Promise<void> {
    this.closed = true;
    this.clearMaxOnTimer();
    this.listeners.clear();
    await this.protocolBackend.close();
  }

  getOperationalState(): Record<string, unknown> {
    const opState = this.protocolBackend.getOperationalState();
    const armedState = (opState.state as LampArmedState) ?? 'unknown';
    const now = Date.now();
    const freshOn = computeFreshness(this.onEvidence, now, this.config.observationMaxAgeMs);
    const freshArmed = computeFreshness(
      recordAcknowledged(this.armedEvidence, armedState, null, this.config.provenance),
      now,
    );

    return {
      status: armedState === 'armed' ? 'ready' : armedState,
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
      provenance: this.determineProvenance(),
      armed: armedState,
      evidence: {
        on: freshOn,
        armed: freshArmed,
      },
    };
  }

  getOperationalStateEvidence(): Record<string, EvidenceState<unknown>> {
    const now = Date.now();
    const freshOn = computeFreshness(this.onEvidence, now, this.config.observationMaxAgeMs);
    const opState = this.protocolBackend.getOperationalState();
    const armedState = (opState.state as LampArmedState) ?? 'unknown';
    const freshArmed = computeFreshness(
      recordAcknowledged(this.armedEvidence, armedState, null, this.config.provenance),
      now,
    );
    return {
      on: freshOn as EvidenceState<unknown>,
      armed: freshArmed as EvidenceState<unknown>,
    };
  }

  async arm(options?: {
    timeoutMs?: number;
    heartbeatIntervalMs?: number;
    requireWatchdog?: boolean;
  }): Promise<Record<string, unknown>> {
    const res = await this.protocolBackend.arm(options);
    this.armedEvidence = recordAcknowledged(
      this.armedEvidence,
      'armed',
      null,
      this.config.provenance,
    );
    return res;
  }

  async disarm(): Promise<Record<string, unknown>> {
    this.clearMaxOnTimer();
    const res = await this.protocolBackend.disarm();
    this.armedEvidence = recordAcknowledged(
      this.armedEvidence,
      'disarmed',
      null,
      this.config.provenance,
    );
    return res;
  }

  async safeState(): Promise<Record<string, unknown>> {
    this.clearMaxOnTimer();
    const res = await this.protocolBackend.safeState();
    this.armedEvidence = recordAcknowledged(
      this.armedEvidence,
      'disarmed',
      null,
      this.config.provenance,
    );
    return res;
  }

  async invoke(
    action: string,
    payload: Record<string, unknown> = {},
    context: BackendInvocationContext = {},
  ): Promise<Record<string, unknown>> {
    if (this.closed) {
      throw new DeviceError('DISCONNECTED', 'Lamp backend is closed.');
    }

    if (action === 'lamp.status' || action === 'status.read') {
      return this.readStatus(context);
    }

    if (action === 'lamp.arm') {
      const armOptions: {
        timeoutMs?: number;
        heartbeatIntervalMs?: number;
        requireWatchdog?: boolean;
      } = {
        requireWatchdog: this.config.requireWatchdog,
      };
      if (typeof payload.timeoutMs === 'number') {
        armOptions.timeoutMs = payload.timeoutMs;
      } else if (this.config.watchdogTimeoutMs !== undefined) {
        armOptions.timeoutMs = this.config.watchdogTimeoutMs;
      }
      if (this.config.heartbeatIntervalMs !== undefined) {
        armOptions.heartbeatIntervalMs = this.config.heartbeatIntervalMs;
      }

      const armResult = await this.protocolBackend.arm(armOptions);
      this.armedEvidence = recordAcknowledged(
        this.armedEvidence,
        'armed',
        null,
        this.config.provenance,
      );
      return {
        armed: 'armed',
        timeoutMs:
          typeof armResult.timeoutMs === 'number'
            ? armResult.timeoutMs
            : (armOptions.timeoutMs ?? 1000),
      };
    }

    if (action === 'lamp.disarm') {
      this.clearMaxOnTimer();
      await this.protocolBackend.disarm();
      this.armedEvidence = recordAcknowledged(
        this.armedEvidence,
        'disarmed',
        null,
        this.config.provenance,
      );
      return { armed: 'disarmed' };
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

      const opState = this.protocolBackend.getOperationalState();
      if (opState.state === 'disarmed') {
        throw new DeviceError(
          'NOT_ARMED',
          'Device is disarmed. Explicit arming (lamp.arm) is required before actuation.',
        );
      }
      if (opState.state === 'tripped') {
        throw new DeviceError(
          'WATCHDOG_TRIPPED',
          'Device watchdog tripped. Re-arming (lamp.arm) is required before actuation.',
        );
      }

      const now = new Date();
      this.onEvidence = recordCommanded(this.onEvidence, targetOn, now, this.config.provenance);

      const electricalLevel = this.config.polarity === 'active-low' ? !targetOn : targetOn;
      const writePayload: Record<string, unknown> = {
        pin: this.config.pin,
        value: electricalLevel,
      };
      if (typeof payload.validityMs === 'number') {
        writePayload.validityMs = payload.validityMs;
      }

      await this.device.invoke(
        'gpio.write',
        writePayload,
        context.signal ? { signal: context.signal } : {},
      );

      this.onEvidence = recordAcknowledged(this.onEvidence, targetOn, now, this.config.provenance);

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

  private async readStatus(context: BackendInvocationContext): Promise<LampStatus> {
    const opState = this.protocolBackend.getOperationalState();
    const armedState = (opState.state as LampArmedState) ?? 'unknown';
    const now = new Date();

    if (this.config.readbackPin !== undefined) {
      const readResult = await this.device.invoke(
        'gpio.read',
        { pin: this.config.readbackPin },
        context.signal ? { signal: context.signal } : {},
      );
      const rawValue = Boolean(readResult.value);
      const observedOn = this.config.readbackPolarity === 'active-low' ? !rawValue : rawValue;
      this.onEvidence = recordObserved(
        this.onEvidence,
        observedOn,
        'gpio-readback',
        now,
        this.config.provenance,
        this.config.observationMaxAgeMs,
      );
    }

    const freshOn = computeFreshness(this.onEvidence, now, this.config.observationMaxAgeMs);
    const freshArmed = computeFreshness(
      recordAcknowledged(this.armedEvidence, armedState, now, this.config.provenance),
      now,
    );

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
      provenance: this.determineProvenance(),
      armed: armedState,
      evidence: {
        on: freshOn,
        armed: freshArmed,
      },
    };
  }

  private determineProvenance(): EvidenceProvenance {
    if (this.config.provenance === 'hardware') {
      return 'hardware';
    }
    return 'simulated';
  }

  private startMaxOnTimer(maxOnMs: number): void {
    this.clearMaxOnTimer();
    this.maxOnTimer = setTimeout(async () => {
      try {
        const offLevel = this.config.polarity === 'active-low' ? true : false;
        await this.device
          .invoke('gpio.write', { pin: this.config.pin, value: offLevel })
          .catch(() => undefined);
        const now = new Date();
        this.onEvidence = recordCommanded(this.onEvidence, false, now, this.config.provenance);
        this.onEvidence = recordAcknowledged(this.onEvidence, false, now, this.config.provenance);
        this.emit('lamp.changed', { on: false, reason: 'max_on_exceeded' });
      } catch {
        // silent safe handling
      }
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

export const createEsp32LampBackend = (options: Record<string, unknown> = {}) =>
  Esp32LampBackend.create(options);
