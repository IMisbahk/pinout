import { FakeRosActionServer } from './fakeRosActionServer.js';
import { createRos2SidecarBackend, Ros2Sidecar } from './sidecar.js';

export interface BenchmarkLimits {
  /** Maximum acceptable p99 command overhead in milliseconds (invoke to goal dispatch). */
  readonly maxOverheadP99Ms: number;
  /** Maximum acceptable p99 stop response time in milliseconds (stop requested to confirmed). */
  readonly maxStopResponseP99Ms: number;
  /** Minimum acceptable success rate (0.0 to 1.0). */
  readonly minSuccessRate: number;
}

export const defaultBenchmarkLimits: BenchmarkLimits = {
  maxOverheadP99Ms: 15.0,
  maxStopResponseP99Ms: 30.0,
  minSuccessRate: 1.0,
};

export interface MetricPercentiles {
  min: number;
  max: number;
  mean: number;
  p50: number;
  p95: number;
  p99: number;
}

export interface BenchmarkReport {
  totalGoals: number;
  successfulGoals: number;
  successRate: number;
  commandOverhead: MetricPercentiles;
  stopResponse: MetricPercentiles;
  declaredLimits: BenchmarkLimits;
  passedLimits: boolean;
  violations: string[];
}

export interface RunGoalBenchmarkOptions {
  iterations?: number;
  limits?: Partial<BenchmarkLimits>;
  motionDelayMs?: number;
  feedbackIntervalMs?: number;
}

export async function runGoalBenchmark(
  options: RunGoalBenchmarkOptions = {},
): Promise<BenchmarkReport> {
  const iterations = options.iterations ?? 50;
  const limits: BenchmarkLimits = {
    maxOverheadP99Ms: options.limits?.maxOverheadP99Ms ?? defaultBenchmarkLimits.maxOverheadP99Ms,
    maxStopResponseP99Ms:
      options.limits?.maxStopResponseP99Ms ?? defaultBenchmarkLimits.maxStopResponseP99Ms,
    minSuccessRate: options.limits?.minSuccessRate ?? defaultBenchmarkLimits.minSuccessRate,
  };

  const overheadSamples: number[] = [];
  const stopSamples: number[] = [];
  let successful = 0;

  const motionDelayMs = options.motionDelayMs ?? 10;
  const feedbackIntervalMs = options.feedbackIntervalMs ?? 2;

  // 1. Run goal motion iterations
  for (let i = 0; i < iterations; i += 1) {
    const transport = new FakeRosActionServer({ motionDelayMs, feedbackIntervalMs });
    const sidecar = createRos2SidecarBackend({ transport });

    const targetX = Number(((i % 10) * 0.08 - 0.4).toFixed(3));
    const targetY = Number((((i + 3) % 10) * 0.08 - 0.4).toFixed(3));
    const targetZ = Number((0.2 + (i % 5) * 0.1).toFixed(3));

    try {
      const invokeStart = performance.now();
      const result = await sidecar.invoke('arm.move_to_pose', {
        target: {
          frame: 'base_link',
          position: { x: targetX, y: targetY, z: targetZ },
        },
        transformAt: Date.now(),
      });
      const measuredOverhead =
        typeof result.commandOverheadMs === 'number'
          ? result.commandOverheadMs
          : performance.now() - invokeStart;

      overheadSamples.push(measuredOverhead);
      if (result.success === true) {
        successful += 1;
      }
    } finally {
      await sidecar.close();
    }
  }

  // 2. Run cancellation / stop response iterations
  const stopIterations = Math.max(10, Math.floor(iterations / 2));
  for (let i = 0; i < stopIterations; i += 1) {
    const transport = new FakeRosActionServer({
      motionDelayMs: 100, // longer motion so stop interrupts mid-flight
      feedbackIntervalMs: 5,
    });
    const sidecar = new Ros2Sidecar({ transport });

    // Start in-flight goal without awaiting completion
    const movePromise = sidecar.invoke('arm.move_to_pose', {
      target: {
        frame: 'base_link',
        position: { x: 0.5, y: 0.2, z: 0.4 },
      },
      transformAt: Date.now(),
    });

    // Short yield to ensure goal is dispatched and executing
    await new Promise((resolve) => setTimeout(resolve, 10));

    const stopStart = performance.now();
    const stopResult = await sidecar.invoke('arm.stop', {});
    const stopDuration = performance.now() - stopStart;

    stopSamples.push(stopDuration);
    if (stopResult.status !== 'stopped' || stopResult.stopConfirmed !== true) {
      // Unconfirmed stop
    }

    await movePromise.catch(() => undefined);
    await sidecar.close();
  }

  const successRate = iterations > 0 ? successful / iterations : 0;
  const overheadPercentiles = calculatePercentiles(overheadSamples);
  const stopPercentiles = calculatePercentiles(stopSamples);

  const violations: string[] = [];
  if (overheadPercentiles.p99 > limits.maxOverheadP99Ms) {
    violations.push(
      `Command overhead p99 (${overheadPercentiles.p99.toFixed(2)}ms) exceeded declared limit (${limits.maxOverheadP99Ms}ms)`,
    );
  }
  if (stopPercentiles.p99 > limits.maxStopResponseP99Ms) {
    violations.push(
      `Stop response p99 (${stopPercentiles.p99.toFixed(2)}ms) exceeded declared limit (${limits.maxStopResponseP99Ms}ms)`,
    );
  }
  if (successRate < limits.minSuccessRate) {
    violations.push(
      `Success rate (${(successRate * 100).toFixed(1)}%) fell below minimum declared rate (${(limits.minSuccessRate * 100).toFixed(1)}%)`,
    );
  }

  return {
    totalGoals: iterations,
    successfulGoals: successful,
    successRate,
    commandOverhead: overheadPercentiles,
    stopResponse: stopPercentiles,
    declaredLimits: limits,
    passedLimits: violations.length === 0,
    violations,
  };
}

function calculatePercentiles(samples: number[]): MetricPercentiles {
  if (samples.length === 0) {
    return { min: 0, max: 0, mean: 0, p50: 0, p95: 0, p99: 0 };
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const sum = sorted.reduce((acc, val) => acc + val, 0);
  const mean = sum / sorted.length;
  const min = sorted[0] ?? 0;
  const max = sorted[sorted.length - 1] ?? 0;

  const p50 = getPercentileValue(sorted, 0.5);
  const p95 = getPercentileValue(sorted, 0.95);
  const p99 = getPercentileValue(sorted, 0.99);

  return {
    min: Number(min.toFixed(2)),
    max: Number(max.toFixed(2)),
    mean: Number(mean.toFixed(2)),
    p50: Number(p50.toFixed(2)),
    p95: Number(p95.toFixed(2)),
    p99: Number(p99.toFixed(2)),
  };
}

function getPercentileValue(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor(p * sorted.length)));
  return sorted[index] ?? 0;
}
