import { describe, expect, it } from 'vitest';
import { runGoalBenchmark } from '../src/benchmark.js';

describe('ROS 2 Sidecar Goal & Stop Benchmark', () => {
  it('meets pre-declared task limits for command overhead, stop response, and success rate', async () => {
    // Declared task limits BEFORE the benchmark run:
    // - Overhead p99 < 15.0ms: Measures Pinout invoke -> validation -> transport sendGoal latency.
    // - Stop response p99 < 30.0ms: Measures stop invocation -> controller cancel -> confirmed stop.
    // - Minimum success rate = 1.0 (100% of non-faulted simulated goals succeed).
    const declaredLimits = {
      maxOverheadP99Ms: 15.0,
      maxStopResponseP99Ms: 30.0,
      minSuccessRate: 1.0,
    };

    const report = await runGoalBenchmark({
      iterations: 30,
      limits: declaredLimits,
      motionDelayMs: 10,
      feedbackIntervalMs: 2,
    });

    // Assert that the benchmark passed all declared constraints
    expect(report.passedLimits).toBe(true);
    expect(report.violations).toEqual([]);

    // Verify metrics structure
    expect(report.totalGoals).toBe(30);
    expect(report.successRate).toBe(1.0);
    expect(report.commandOverhead.p99).toBeLessThanOrEqual(declaredLimits.maxOverheadP99Ms);
    expect(report.stopResponse.p99).toBeLessThanOrEqual(declaredLimits.maxStopResponseP99Ms);

    expect(report.commandOverhead.p50).toBeGreaterThanOrEqual(0);
    expect(report.stopResponse.p50).toBeGreaterThanOrEqual(0);
  });
});
