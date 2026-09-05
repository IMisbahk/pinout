import {
  DeviceError,
  ValidationError,
  computeFreshness,
  recordAcknowledged,
  recordCommanded,
  recordObserved,
  unknownEvidence,
  type EvidenceProvenance,
  type EvidenceSource,
  type EvidenceState,
  type DeviceBackend,
  type LampArmedState,
  type LampPolarity,
  type LampSafeLevel,
  type LampStatus,
  type LampBackendLike,
} from '@pinout/core';
import { ModbusTcpClient } from './tcpClient.js';
import { type ModbusRtuClient } from './rtuClient.js';
import { SimulatedModbusServer } from './simulator.js';

export interface BackendInvocationContext {
  signal?: AbortSignal;
  reportProgress?: (fraction: number | null, message?: string) => void;
}

export interface ModbusLampConfig {
  coil?: number | undefined;
  pin?: number | undefined;
  discreteInput?: number | undefined;
  readbackPin?: number | undefined;
  unitId?: number | undefined;
  polarity?: LampPolarity | undefined;
  safeLevel?: LampSafeLevel | undefined;
  readbackPolarity?: LampPolarity | undefined;
  maxOnMs?: number | undefined;
  observationMaxAgeMs?: number | undefined;
  requireFreshObservation?: boolean | undefined;
  requireWatchdog?: boolean | undefined;
  watchdogTimeoutMs?: number | undefined;
  autoArm?: boolean | undefined;
  provenance?: EvidenceProvenance | undefined;
  simulated?: boolean | undefined;
  client?: ModbusTcpClient | ModbusRtuClient | undefined;
  server?: SimulatedModbusServer | undefined;
  host?: string | undefined;
  port?: number | undefined;
}

export interface ValidatedModbusLampConfig {
  coil: number;
  discreteInput?: number | undefined;
  unitId: number;
  polarity: LampPolarity;
  safeLevel: LampSafeLevel;
  readbackPolarity: LampPolarity;
  maxOnMs?: number | undefined;
  observationMaxAgeMs: number;
  requireFreshObservation: boolean;
  requireWatchdog: boolean;
  watchdogTimeoutMs?: number | undefined;
  autoArm: boolean;
  provenance: EvidenceProvenance;
  simulated: boolean;
  client?: ModbusTcpClient | ModbusRtuClient | undefined;
  server?: SimulatedModbusServer | undefined;
  host: string;
  port?: number | undefined;
}

export function validateModbusLampConfig(
  rawConfig: Record<string, unknown> = {},
  allowEmptyDefaults = true,
): ValidatedModbusLampConfig {
  const isEssentiallyEmpty =
    Object.keys(rawConfig).length === 0 ||
    (Object.keys(rawConfig).length === 1 && rawConfig.simulated !== undefined);

  if (isEssentiallyEmpty && allowEmptyDefaults) {
    return {
      coil: 0,
      unitId: 1,
      polarity: 'active-high',
      safeLevel: 'low',
      readbackPolarity: 'active-high',
      observationMaxAgeMs: 5000,
      requireFreshObservation: false,
      requireWatchdog: true,
      autoArm: false,
      provenance: 'simulated',
      simulated: true,
      host: '127.0.0.1',
    };
  }

  const rawCoil = rawConfig.coil ?? rawConfig.pin;
  if (rawCoil === undefined) {
    throw new DeviceError(
      'UNSUPPORTED_CONFIGURATION',
      'Modbus lamp configuration requires a numeric "coil" (or "pin") address.',
    );
  }
  if (typeof rawCoil !== 'number' || !Number.isInteger(rawCoil) || rawCoil < 0 || rawCoil > 65535) {
    throw new DeviceError(
      'UNSUPPORTED_CONFIGURATION',
      'Modbus lamp "coil" address must be an integer in [0, 65535].',
    );
  }
  const coil = rawCoil;

  let discreteInput: number | undefined;
  const rawDiscreteInput = rawConfig.discreteInput ?? rawConfig.readbackPin;
  if (rawDiscreteInput !== undefined) {
    if (
      typeof rawDiscreteInput !== 'number' ||
      !Number.isInteger(rawDiscreteInput) ||
      rawDiscreteInput < 0 ||
      rawDiscreteInput > 65535
    ) {
      throw new DeviceError(
        'UNSUPPORTED_CONFIGURATION',
        'Modbus lamp "discreteInput" address must be an integer in [0, 65535].',
      );
    }
    discreteInput = rawDiscreteInput;
  }

  if (rawConfig.polarity !== 'active-high' && rawConfig.polarity !== 'active-low') {
    throw new DeviceError(
      'UNSUPPORTED_CONFIGURATION',
      'Lamp configuration requires "polarity" set to "active-high" or "active-low".',
    );
  }
  const polarity = rawConfig.polarity as LampPolarity;

  let safeLevel: LampSafeLevel;
  if (rawConfig.safeLevel === undefined) {
    safeLevel = polarity === 'active-low' ? 'high' : 'low';
  } else {
    const rawSafeLevel = rawConfig.safeLevel as string;
    if (
      rawSafeLevel !== 'low' &&
      rawSafeLevel !== 'high' &&
      rawSafeLevel !== 'high-z' &&
      rawSafeLevel !== 'hold'
    ) {
      throw new DeviceError(
        'UNSUPPORTED_CONFIGURATION',
        `Unsupported safeLevel '${rawSafeLevel}'. Must be 'low', 'high', 'high-z', or 'hold'.`,
      );
    }
    safeLevel = rawSafeLevel as LampSafeLevel;

    if (polarity === 'active-high' && safeLevel === 'high') {
      throw new DeviceError(
        'UNSUPPORTED_CONFIGURATION',
        'Active-high lamp configuration cannot specify safeLevel "high" because safe state would energize the lamp.',
      );
    }
    if (polarity === 'active-low' && safeLevel === 'low') {
      throw new DeviceError(
        'UNSUPPORTED_CONFIGURATION',
        'Active-low lamp configuration cannot specify safeLevel "low" because safe state would energize the lamp.',
      );
    }
  }

  let readbackPolarity: LampPolarity = 'active-high';
  if (rawConfig.readbackPolarity !== undefined) {
    if (
      rawConfig.readbackPolarity !== 'active-high' &&
      rawConfig.readbackPolarity !== 'active-low'
    ) {
      throw new DeviceError(
        'UNSUPPORTED_CONFIGURATION',
        'Lamp configuration readbackPolarity must be "active-high" or "active-low".',
      );
    }
    readbackPolarity = rawConfig.readbackPolarity as LampPolarity;
  }

  let maxOnMs: number | undefined;
  if (rawConfig.maxOnMs !== undefined) {
    if (
      typeof rawConfig.maxOnMs !== 'number' ||
      rawConfig.maxOnMs <= 0 ||
      !Number.isFinite(rawConfig.maxOnMs)
    ) {
      throw new ValidationError('maxOnMs must be a positive finite number.');
    }
    maxOnMs = rawConfig.maxOnMs;
  }

  let observationMaxAgeMs = 5000;
  if (rawConfig.observationMaxAgeMs !== undefined) {
    if (
      typeof rawConfig.observationMaxAgeMs !== 'number' ||
      rawConfig.observationMaxAgeMs <= 0 ||
      !Number.isFinite(rawConfig.observationMaxAgeMs)
    ) {
      throw new ValidationError('observationMaxAgeMs must be a positive finite number.');
    }
    observationMaxAgeMs = rawConfig.observationMaxAgeMs;
  }

  const requireFreshObservation = rawConfig.requireFreshObservation === true;
  const simulated = rawConfig.simulated !== false;
  const provenance: EvidenceProvenance =
    rawConfig.provenance === 'hardware'
      ? 'hardware'
      : ((rawConfig.provenance as EvidenceProvenance | undefined) ?? 'simulated');

  const unitId = typeof rawConfig.unitId === 'number' ? rawConfig.unitId : 1;
  const host = typeof rawConfig.host === 'string' ? rawConfig.host : '127.0.0.1';
  const port = typeof rawConfig.port === 'number' ? rawConfig.port : undefined;

  return {
    coil,
    discreteInput,
    unitId,
    polarity,
    safeLevel,
    readbackPolarity,
    maxOnMs,
    observationMaxAgeMs,
    requireFreshObservation,
    requireWatchdog: rawConfig.requireWatchdog !== false,
    watchdogTimeoutMs:
      typeof rawConfig.watchdogTimeoutMs === 'number' ? rawConfig.watchdogTimeoutMs : undefined,
    autoArm: rawConfig.autoArm === true,
    provenance,
    simulated,
    client: rawConfig.client as ModbusTcpClient | ModbusRtuClient | undefined,
    server: rawConfig.server as SimulatedModbusServer | undefined,
    host,
    port,
  };
}

export class ModbusLampBackend implements DeviceBackend, LampBackendLike {
  readonly kind = 'protocol' as const;
  private readonly client: ModbusTcpClient | ModbusRtuClient;
  private readonly ownedServer: SimulatedModbusServer | undefined;
  private readonly config: ValidatedModbusLampConfig;
  private armedState: LampArmedState = 'disarmed';
  private onEvidence: EvidenceState<boolean>;
  private armedEvidence: EvidenceState<LampArmedState>;
  private simulatedReadbackLevel: boolean | undefined = undefined;
  private maxOnTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly listeners = new Set<(event: string, payload: Record<string, unknown>) => void>();
  private closed = false;

  constructor(
    client: ModbusTcpClient | ModbusRtuClient,
    config: ValidatedModbusLampConfig,
    ownedServer?: SimulatedModbusServer,
  ) {
    this.client = client;
    this.config = config;
    this.ownedServer = ownedServer;
    this.onEvidence = unknownEvidence<boolean>(this.config.provenance);
    this.armedEvidence = unknownEvidence<LampArmedState>(this.config.provenance);

    if (this.config.autoArm) {
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

  static async create(options: ModbusLampConfig = {}): Promise<ModbusLampBackend> {
    const config = validateModbusLampConfig(options as Record<string, unknown>);

    if (config.client) {
      if ('connect' in config.client && typeof config.client.connect === 'function') {
        await config.client.connect().catch(() => undefined);
      }
      return new ModbusLampBackend(config.client, config, config.server);
    }

    if (config.simulated || options.simulated !== false) {
      let server = config.server;
      let host = config.host;
      let port = config.port;

      let createdServer: SimulatedModbusServer | undefined;
      if (!server) {
        createdServer = new SimulatedModbusServer({ host: config.host });
        const started = await createdServer.start();
        host = started.host;
        port = started.port;
        server = createdServer;
      } else {
        port = server.port;
      }

      const client = new ModbusTcpClient({
        host,
        port: port!,
        unitId: config.unitId,
        timeoutMs: 1000,
      });
      await client.connect();

      return new ModbusLampBackend(client, config, createdServer ?? server);
    }

    const client = new ModbusTcpClient({
      host: config.host,
      port: config.port ?? 502,
      unitId: config.unitId,
      timeoutMs: 3000,
    });
    await client.connect();

    return new ModbusLampBackend(client, config);
  }

  subscribe(handler: (event: string, payload: Record<string, unknown>) => void): () => void {
    this.listeners.add(handler);
    return () => this.listeners.delete(handler);
  }

  async close(): Promise<void> {
    this.closed = true;
    this.clearMaxOnTimer();
    this.listeners.clear();
    await this.client.close().catch(() => undefined);
    if (this.ownedServer) {
      await this.ownedServer.close().catch(() => undefined);
    }
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

  async arm(
    options: { timeoutMs?: number; requireWatchdog?: boolean; ignoreWatchdog?: boolean } = {},
  ): Promise<Record<string, unknown>> {
    const enforceWatchdog = options.requireWatchdog ?? this.config.requireWatchdog;
    if (enforceWatchdog && !options.ignoreWatchdog) {
      throw new DeviceError(
        'WATCHDOG_NOT_SUPPORTED',
        'Modbus adapter does not provide a device-local hardware watchdog. Set requireWatchdog: false to explicitly acknowledge host-loss limitation.',
      );
    }

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

    const safeCoilLevel = this.config.polarity === 'active-low' ? true : false;
    await this.client.writeSingleCoil(this.config.coil, safeCoilLevel).catch(() => undefined);

    if (this.config.discreteInput !== undefined) {
      if (this.ownedServer && this.simulatedReadbackLevel === undefined) {
        const safeReadback = this.config.readbackPolarity === 'active-low' ? true : false;
        this.ownedServer.setDiscreteInput(this.config.discreteInput, safeReadback);
      }
      this.onEvidence = recordObserved(
        this.onEvidence,
        false,
        this.config.provenance === 'hardware' ? 'sensor' : 'simulated',
        null,
        this.config.provenance,
        this.config.observationMaxAgeMs,
      );
    }

    this.emit('safe_state.applied', { coil: this.config.coil, safeLevel: this.config.safeLevel });
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

    const safeCoilLevel = this.config.polarity === 'active-low' ? true : false;
    await this.client.writeSingleCoil(this.config.coil, safeCoilLevel).catch(() => undefined);

    this.emit('safe_state.applied', { coil: this.config.coil, safeLevel: this.config.safeLevel });
    return { applied: true, coil: this.config.coil, safeLevel: this.config.safeLevel };
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
    this.emit('device.tripped', { reason, stoppedCoils: [this.config.coil] });
  }

  setSimulatedReadbackLevel(level: boolean): void {
    this.simulatedReadbackLevel = level;
    if (this.ownedServer && this.config.discreteInput !== undefined) {
      this.ownedServer.setDiscreteInput(this.config.discreteInput, level);
    }
    const observedOn = this.config.readbackPolarity === 'active-low' ? !level : level;
    this.onEvidence = recordObserved(
      this.onEvidence,
      observedOn,
      this.config.provenance === 'hardware' ? 'sensor' : 'simulated',
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
      throw new DeviceError('DISCONNECTED', 'Modbus lamp backend is closed.');
    }

    if (action === 'lamp.status' || action === 'status.read') {
      return this.readStatus();
    }

    if (action === 'lamp.arm') {
      const timeoutMs =
        typeof payload.timeoutMs === 'number'
          ? payload.timeoutMs
          : (this.config.watchdogTimeoutMs ?? 1000);
      const ignoreWatchdog = payload.requireWatchdog === false || !this.config.requireWatchdog;
      return this.arm({ timeoutMs, ignoreWatchdog });
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

      const coilValue = this.config.polarity === 'active-low' ? !targetOn : targetOn;
      await this.client.writeSingleCoil(this.config.coil, coilValue);

      this.onEvidence = recordAcknowledged(this.onEvidence, targetOn, now, this.config.provenance);

      if (this.config.discreteInput !== undefined) {
        if (this.ownedServer && this.simulatedReadbackLevel === undefined) {
          const physicalHigh = this.config.polarity === 'active-low' ? !targetOn : targetOn;
          this.ownedServer.setDiscreteInput(this.config.discreteInput, physicalHigh);
        }

        const inputValues = await this.client.readDiscreteInputs(this.config.discreteInput, 1);
        const rawInput = inputValues[0] ?? false;
        const observedOn = this.config.readbackPolarity === 'active-low' ? !rawInput : rawInput;
        this.onEvidence = recordObserved(
          this.onEvidence,
          observedOn,
          this.config.provenance === 'hardware' ? 'sensor' : 'simulated',
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

  private async readStatus(): Promise<LampStatus> {
    if (this.config.discreteInput !== undefined) {
      if (this.ownedServer && this.simulatedReadbackLevel !== undefined) {
        this.ownedServer.setDiscreteInput(this.config.discreteInput, this.simulatedReadbackLevel);
      }
      const inputValues = await this.client.readDiscreteInputs(this.config.discreteInput, 1);
      const rawInput = inputValues[0] ?? false;
      const observedOn = this.config.readbackPolarity === 'active-low' ? !rawInput : rawInput;
      const now = new Date();
      this.onEvidence = recordObserved(
        this.onEvidence,
        observedOn,
        this.config.provenance === 'hardware' ? 'sensor' : 'simulated',
        now,
        this.config.provenance,
        this.config.observationMaxAgeMs,
      );
    }

    return this.buildStatus();
  }

  private buildStatus(): LampStatus {
    const now = Date.now();
    const freshOn = computeFreshness(this.onEvidence, now, this.config.observationMaxAgeMs);
    const freshArmed = computeFreshness(this.armedEvidence, now);

    const observedSource: EvidenceSource =
      this.config.discreteInput !== undefined ? freshOn.observed.source : 'none';

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
        value: this.config.discreteInput !== undefined ? freshOn.observed.value : null,
        on: this.config.discreteInput !== undefined ? freshOn.observed.value : null,
        at: this.config.discreteInput !== undefined ? freshOn.observed.at : null,
        source: observedSource,
      },
      freshnessMs: this.config.discreteInput !== undefined ? freshOn.freshnessMs : null,
      stale: this.config.discreteInput !== undefined ? freshOn.stale : false,
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
    this.maxOnTimer = setTimeout(async () => {
      try {
        const safeCoilLevel = this.config.polarity === 'active-low' ? true : false;
        await this.client.writeSingleCoil(this.config.coil, safeCoilLevel).catch(() => undefined);
        const now = new Date();
        this.onEvidence = recordCommanded(this.onEvidence, false, now, this.config.provenance);
        this.onEvidence = recordAcknowledged(this.onEvidence, false, now, this.config.provenance);
        if (this.config.discreteInput !== undefined) {
          if (this.ownedServer && this.simulatedReadbackLevel === undefined) {
            this.ownedServer.setDiscreteInput(this.config.discreteInput, safeCoilLevel);
          }
          this.onEvidence = recordObserved(
            this.onEvidence,
            false,
            this.config.provenance === 'hardware' ? 'sensor' : 'simulated',
            now,
            this.config.provenance,
            this.config.observationMaxAgeMs,
          );
        }
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

export function createModbusLampBackend(
  options: ModbusLampConfig = {},
): Promise<ModbusLampBackend> {
  return ModbusLampBackend.create(options);
}
