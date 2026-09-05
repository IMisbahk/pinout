import { ValidationError, DeviceError } from '../../errors.js';
import {
  assertGpioPin,
  assertEsp32WritePin,
  assertEsp32ReadPin,
  assertPolarity,
  assertSafeLevel,
} from '../../drivers/esp32/pins.js';
import type { Transport } from '../../types.js';
import type { Device } from '../../device.js';
import type {
  EvidenceProvenance,
  EvidenceSource,
  EvidenceState,
  EvidenceValue,
} from '../../spec/evidence.js';

export type LampPolarity = 'active-high' | 'active-low';
export type LampSafeLevel = 'low' | 'high' | 'high-z' | 'hold';
export type LampArmedState = 'armed' | 'disarmed' | 'tripped' | 'unknown';
export type LampObservedSource = EvidenceSource;

export type LampCommandedState = EvidenceValue<boolean> & {
  on: boolean | null;
  [key: string]: unknown;
};

export type LampAcknowledgedState = EvidenceValue<boolean> & {
  on: boolean | null;
  [key: string]: unknown;
};

export type LampObservedState = EvidenceValue<boolean> & {
  on: boolean | null;
  [key: string]: unknown;
};

export interface LampEvidenceBundle {
  on: EvidenceState<boolean>;
  armed: EvidenceState<LampArmedState>;
  [key: string]: unknown;
}

export interface LampStatus {
  commanded: LampCommandedState;
  acknowledged: LampAcknowledgedState;
  observed: LampObservedState;
  freshnessMs: number | null;
  stale: boolean;
  provenance: EvidenceProvenance;
  armed: LampArmedState;
  evidence: LampEvidenceBundle;
  [key: string]: unknown;
}

export interface LampConfig {
  pin?: number | undefined;
  polarity?: LampPolarity | undefined;
  safeLevel?: LampSafeLevel | undefined;
  readbackPin?: number | undefined;
  readbackPolarity?: LampPolarity | undefined;
  maxOnMs?: number | undefined;
  observationMaxAgeMs?: number | undefined;
  requireFreshObservation?: boolean | undefined;
  requireWatchdog?: boolean | undefined;
  watchdogTimeoutMs?: number | undefined;
  autoArm?: boolean | undefined;
  autoHeartbeat?: boolean | undefined;
  heartbeatIntervalMs?: number | undefined;
  provenance?: EvidenceProvenance | undefined;
  simulated?: boolean | undefined;
  transport?: Transport | undefined;
  device?: Device | undefined;
}

export interface ValidatedLampConfig {
  pin: number;
  polarity: LampPolarity;
  safeLevel: LampSafeLevel;
  readbackPin?: number | undefined;
  readbackPolarity: LampPolarity;
  maxOnMs?: number | undefined;
  observationMaxAgeMs: number;
  requireFreshObservation: boolean;
  requireWatchdog: boolean;
  watchdogTimeoutMs?: number | undefined;
  autoArm: boolean;
  autoHeartbeat?: boolean | undefined;
  heartbeatIntervalMs?: number | undefined;
  provenance: EvidenceProvenance;
  simulated: boolean;
  transport?: Transport | undefined;
  device?: Device | undefined;
}

export function validateLampConfig(
  rawConfig: Record<string, unknown> = {},
  allowEmptyDefaults = true,
): ValidatedLampConfig {
  const isEssentiallyEmpty =
    Object.keys(rawConfig).length === 0 ||
    (Object.keys(rawConfig).length === 1 && rawConfig.simulated !== undefined);

  if (isEssentiallyEmpty && allowEmptyDefaults) {
    return {
      pin: 2,
      polarity: 'active-high',
      safeLevel: 'low',
      readbackPolarity: 'active-high',
      observationMaxAgeMs: 5000,
      requireFreshObservation: false,
      requireWatchdog: true,
      autoArm: false,
      simulated: rawConfig.simulated !== false,
      provenance: 'simulated',
      transport: rawConfig.transport as Transport | undefined,
      device: rawConfig.device as Device | undefined,
    };
  }

  if (rawConfig.pin === undefined) {
    throw new DeviceError(
      'UNSUPPORTED_CONFIGURATION',
      'Lamp configuration requires a numeric "pin" field.',
    );
  }
  const pin = assertGpioPin(rawConfig.pin);
  assertEsp32WritePin(pin);

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
    safeLevel = assertSafeLevel(rawConfig.safeLevel) as LampSafeLevel;
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

  let readbackPin: number | undefined;
  if (rawConfig.readbackPin !== undefined) {
    readbackPin = assertGpioPin(rawConfig.readbackPin);
    assertEsp32ReadPin(readbackPin);
  }

  let readbackPolarity: LampPolarity = 'active-high';
  if (rawConfig.readbackPolarity !== undefined) {
    readbackPolarity = assertPolarity(rawConfig.readbackPolarity) as LampPolarity;
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

  return {
    pin,
    polarity,
    safeLevel,
    readbackPin,
    readbackPolarity,
    maxOnMs,
    observationMaxAgeMs,
    requireFreshObservation,
    requireWatchdog: rawConfig.requireWatchdog !== false,
    watchdogTimeoutMs:
      typeof rawConfig.watchdogTimeoutMs === 'number' ? rawConfig.watchdogTimeoutMs : undefined,
    autoArm: rawConfig.autoArm === true,
    autoHeartbeat:
      typeof rawConfig.autoHeartbeat === 'boolean' ? rawConfig.autoHeartbeat : undefined,
    heartbeatIntervalMs:
      typeof rawConfig.heartbeatIntervalMs === 'number' ? rawConfig.heartbeatIntervalMs : undefined,
    provenance,
    simulated,
    transport: rawConfig.transport as Transport | undefined,
    device: rawConfig.device as Device | undefined,
  };
}
