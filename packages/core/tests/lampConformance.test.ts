import { describe, expect, it } from 'vitest';
import {
  createEsp32LampBackend,
  createSimulatedLampBackend,
  runLampConformance,
  simulatedEsp32,
  SimulatedLampBackend,
} from '@pinout/core';

describe('Lamp Module Shared Conformance Suite', () => {
  it('runs conformance suite successfully against in-process SimulatedLampBackend', async () => {
    const result = await runLampConformance(
      () =>
        new SimulatedLampBackend({
          pin: 2,
          polarity: 'active-high',
          safeLevel: 'low',
        }),
    );

    expect(result.passed).toBe(true);
    expect(result.checks.length).toBeGreaterThan(0);
    for (const check of result.checks) {
      expect(check.status).not.toBe('failed');
    }
  });

  it('runs conformance suite successfully against Esp32LampBackend with simulatedEsp32 transport', async () => {
    const result = await runLampConformance(() =>
      createEsp32LampBackend({
        transport: simulatedEsp32(),
        pin: 2,
        polarity: 'active-high',
        safeLevel: 'low',
      }),
    );

    expect(result.passed).toBe(true);
    expect(result.checks.length).toBeGreaterThan(0);
    for (const check of result.checks) {
      expect(check.status).not.toBe('failed');
    }
  });

  it('handles backend with readback observation in conformance check', async () => {
    const result = await runLampConformance(
      () =>
        createSimulatedLampBackend({
          pin: 2,
          polarity: 'active-high',
          safeLevel: 'low',
          readbackPin: 13,
          readbackPolarity: 'active-high',
        }),
      { hasReadback: true },
    );

    expect(result.passed).toBe(true);
    const evidenceCheck = result.checks.find((c) => c.name === 'status evidence model after write');
    expect(evidenceCheck?.status).toBe('passed');
  });
});
