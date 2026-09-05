import { DeviceError } from '../../errors.js';
import type { DeviceBackend } from '../../runtime/types.js';
import { validateLampConfig, type LampStatus } from './types.js';

export interface LampBackendLike extends DeviceBackend {
  injectTrip?(reason?: string): void;
  setSimulatedReadbackLevel?(level: boolean): void;
}

export interface LampConformanceOptions {
  hasReadback?: boolean;
}

export type LampCheckStatus = 'passed' | 'failed' | 'skipped';

export interface LampConformanceCheck {
  name: string;
  status: LampCheckStatus;
  detail?: string;
}

export interface LampConformanceResult {
  passed: boolean;
  checks: LampConformanceCheck[];
}

export async function runLampConformance(
  factory: (options?: Record<string, unknown>) => Promise<LampBackendLike> | LampBackendLike,
  options: LampConformanceOptions = {},
): Promise<LampConformanceResult> {
  const checks: LampConformanceCheck[] = [];

  const recordPass = (name: string, detail?: string) =>
    checks.push({ name, status: 'passed', ...(detail ? { detail } : {}) });
  const recordFail = (name: string, detail?: string) =>
    checks.push({ name, status: 'failed', ...(detail ? { detail } : {}) });
  const recordSkip = (name: string, detail?: string) =>
    checks.push({ name, status: 'skipped', ...(detail ? { detail } : {}) });

  // 1. Config validation check: Active-low with safeLevel low must be rejected
  try {
    validateLampConfig({ pin: 4, polarity: 'active-low', safeLevel: 'low' }, false);
    recordFail(
      'active-low safe level validation',
      'Configuration with active-low and safeLevel low was not rejected.',
    );
  } catch (error) {
    if (error instanceof DeviceError && error.code === 'UNSUPPORTED_CONFIGURATION') {
      recordPass('active-low safe level validation');
    } else if (
      error instanceof Error &&
      /UNSUPPORTED_CONFIGURATION|safeLevel/i.test(error.message)
    ) {
      recordPass('active-low safe level validation');
    } else {
      recordFail(
        'active-low safe level validation',
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  let backend: LampBackendLike | undefined;
  try {
    backend = await factory();
  } catch (error) {
    recordFail('backend instantiation', error instanceof Error ? error.message : String(error));
    return finalize(checks);
  }

  try {
    // 2. Disarmed at start
    const initialStatus = (await backend.invoke('lamp.status', {})) as LampStatus;
    if (initialStatus.armed === 'disarmed') {
      recordPass('disarmed at start');
    } else {
      recordFail(
        'disarmed at start',
        `Expected initial state 'disarmed', got '${String(initialStatus.armed)}'.`,
      );
    }

    // 3. Actuation rejected while disarmed
    let rejectedWhileDisarmed = false;
    try {
      await backend.invoke('lamp.on', {});
    } catch (error) {
      if (
        (error instanceof DeviceError && error.code === 'NOT_ARMED') ||
        (error instanceof Error && /NOT_ARMED|disarmed/i.test(error.message))
      ) {
        rejectedWhileDisarmed = true;
      }
    }
    if (rejectedWhileDisarmed) {
      recordPass('actuation rejected before arm');
    } else {
      recordFail('actuation rejected before arm', 'lamp.on did not throw NOT_ARMED when disarmed.');
    }

    // 4. Explicit arm
    const armResult = await backend.invoke('lamp.arm', { timeoutMs: 5000 });
    if (armResult.armed === 'armed') {
      recordPass('explicit arm');
    } else {
      recordFail(
        'explicit arm',
        `Expected { armed: 'armed' }, received ${JSON.stringify(armResult)}.`,
      );
    }

    // 5. Turn lamp on & verify status evidence model
    const onResult = await backend.invoke('lamp.on', {});
    if (onResult.on === true) {
      recordPass('turn lamp on');
    } else {
      recordFail(
        'turn lamp on',
        `lamp.on did not return { on: true }, got ${JSON.stringify(onResult)}.`,
      );
    }

    const statusAfterOn = (await backend.invoke('lamp.status', {})) as LampStatus;
    const commandedOk =
      statusAfterOn.commanded?.on === true && typeof statusAfterOn.commanded?.at === 'string';
    const acknowledgedOk =
      statusAfterOn.acknowledged?.on === true && typeof statusAfterOn.acknowledged?.at === 'string';
    const observedOk = options.hasReadback
      ? statusAfterOn.observed?.source === 'gpio-readback' ||
        statusAfterOn.observed?.source === 'simulated'
      : statusAfterOn.observed?.source === 'none' && statusAfterOn.observed?.on === null;

    if (commandedOk && acknowledgedOk && observedOk) {
      recordPass('status evidence model after write');
    } else {
      recordFail(
        'status evidence model after write',
        `Evidence shape mismatch: commanded=${JSON.stringify(statusAfterOn.commanded)}, acknowledged=${JSON.stringify(statusAfterOn.acknowledged)}, observed=${JSON.stringify(statusAfterOn.observed)}.`,
      );
    }

    // 6. Turn lamp off
    const offResult = await backend.invoke('lamp.off', {});
    const statusAfterOff = (await backend.invoke('lamp.status', {})) as LampStatus;
    if (
      offResult.on === false &&
      statusAfterOff.commanded?.on === false &&
      statusAfterOff.acknowledged?.on === false
    ) {
      recordPass('turn lamp off');
    } else {
      recordFail(
        'turn lamp off',
        `lamp.off failed to update status: ${JSON.stringify(statusAfterOff)}.`,
      );
    }

    // 7. Explicit disarm applies safe level
    const disarmResult = await backend.invoke('lamp.disarm', {});
    const statusAfterDisarm = (await backend.invoke('lamp.status', {})) as LampStatus;
    let rejectedAfterDisarm = false;
    try {
      await backend.invoke('lamp.on', {});
    } catch {
      rejectedAfterDisarm = true;
    }

    if (
      disarmResult.armed === 'disarmed' &&
      statusAfterDisarm.armed === 'disarmed' &&
      rejectedAfterDisarm
    ) {
      recordPass('disarm and safe state enforcement');
    } else {
      recordFail(
        'disarm and safe state enforcement',
        'lamp.disarm did not transition state to disarmed or block actuation.',
      );
    }

    // 8. Watchdog trip and re-arm recovery
    if (typeof backend.injectTrip === 'function') {
      await backend.invoke('lamp.arm', { timeoutMs: 1000 });
      backend.injectTrip('TEST_TRIP');
      const trippedStatus = (await backend.invoke('lamp.status', {})) as LampStatus;
      let rejectedWhileTripped = false;
      try {
        await backend.invoke('lamp.on', {});
      } catch (error) {
        if (
          (error instanceof DeviceError && error.code === 'WATCHDOG_TRIPPED') ||
          (error instanceof Error && /WATCHDOG_TRIPPED|tripped/i.test(error.message))
        ) {
          rejectedWhileTripped = true;
        }
      }

      const rearmResult = await backend.invoke('lamp.arm', { timeoutMs: 5000 });
      const rearmOn = await backend.invoke('lamp.on', {});

      if (
        trippedStatus.armed === 'tripped' &&
        rejectedWhileTripped &&
        rearmResult.armed === 'armed' &&
        rearmOn.on === true
      ) {
        recordPass('trip recovery and re-arm');
      } else {
        recordFail(
          'trip recovery and re-arm',
          'Trip state did not block actuation or recover on lamp.arm.',
        );
      }
    } else {
      recordSkip('trip recovery and re-arm', 'Backend does not implement injectTrip() hook.');
    }

    // 9. Provenance present and honest
    const finalStatus = (await backend.invoke('lamp.status', {})) as LampStatus;
    if (finalStatus.provenance === 'simulated' || finalStatus.provenance === 'hardware') {
      recordPass('honest provenance declaration');
    } else {
      recordFail(
        'honest provenance declaration',
        `Invalid provenance: '${String(finalStatus.provenance)}'.`,
      );
    }

    // 10. Generic Evidence Contract getOperationalStateEvidence()
    if (typeof backend.getOperationalStateEvidence === 'function') {
      const evidenceMap = backend.getOperationalStateEvidence();
      if (
        evidenceMap &&
        typeof evidenceMap === 'object' &&
        'on' in evidenceMap &&
        'armed' in evidenceMap
      ) {
        recordPass('generic evidence contract getOperationalStateEvidence');
      } else {
        recordFail(
          'generic evidence contract getOperationalStateEvidence',
          'Missing on or armed evidence keys.',
        );
      }
    } else {
      recordFail(
        'generic evidence contract getOperationalStateEvidence',
        'getOperationalStateEvidence() not implemented.',
      );
    }
  } finally {
    if (backend) {
      await backend.close().catch(() => undefined);
    }
  }

  return finalize(checks);
}

function finalize(checks: LampConformanceCheck[]): LampConformanceResult {
  return {
    passed: checks.every((check) => check.status === 'passed' || check.status === 'skipped'),
    checks,
  };
}
