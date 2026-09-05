/**
 * ROS 2 Sidecar Simulator Demo — Governed Robot Manipulation Lifecycle.
 *
 * Demonstrates:
 * 1. Registering the narrow ROS 2 sidecar module in PinoutRuntime.
 * 2. Pre-declaring task limits before execution (overhead, stop response, success rate).
 * 3. Bounded Cartesian manipulation task with high-rate feedback on StreamBus (off MCP).
 * 4. Safety gates: Frame tree validation (FRAME_MISSING) & transform freshness (TRANSFORM_STALE).
 * 5. Independent stop (arm.stop) mid-trajectory with controller confirmation.
 * 6. Controller loss mid-motion handling (OPERATION_REQUIRES_RECONCILIATION).
 * 7. Benchmark metrics report with p50/p95/p99 command overhead and stop response times.
 *
 * NOTICE: SOFTWARE / SIMULATOR ONLY. No physical hardware is actuated.
 *
 * Usage:
 *   npx tsx examples/ros2-sidecar.ts
 */
import { PinoutRuntime, PinoutStructuredError, StreamBus } from '@pinout/core';
import {
  createRos2SidecarBackend,
  FakeRosActionServer,
  ros2SidecarModule,
  ros2SidecarModuleId,
  runGoalBenchmark,
} from '../packages/ros2-sidecar/src/index.js';

async function main(): Promise<void> {
  console.log('================================================================================');
  console.log('        PINOUT ROS 2 SIDECAR DEMO — SOFTWARE SIMULATOR ONLY');
  console.log('  (Notice: No physical hardware is actuated; all kinematics & links are simulated)');
  console.log('================================================================================\n');

  const streamBus = new StreamBus();
  const transport = new FakeRosActionServer({ motionDelayMs: 30, feedbackIntervalMs: 5 });
  const backend = createRos2SidecarBackend({
    transport,
    streamBus,
    deviceId: 'arm-sim-01',
    maxTransformAgeMs: 3000,
  });

  const runtime = new PinoutRuntime();
  const device = await runtime.registerModuleDevice(ros2SidecarModule, {
    id: 'arm-sim-01',
    simulated: true,
    backendOptions: {},
  });

  console.log(`[setup] Device '${device.id}' registered under module '${ros2SidecarModuleId}'.`);
  console.log(`[setup] Governed capabilities: ${device.capabilityNames().join(', ')}`);

  // Subscribe to high-rate feedback stream on StreamBus
  const streamHandle = streamBus.subscribe(backend.feedbackStreamId);
  const streamFrames: Array<{
    fraction: number;
    currentPosition: { x: number; y: number; z: number };
  }> = [];

  (async () => {
    for await (const frame of streamHandle) {
      const data = frame.data as {
        fraction: number;
        currentPosition: { x: number; y: number; z: number };
      };
      streamFrames.push(data);
    }
  })().catch(() => undefined);

  try {
    // -------------------------------------------------------------------------
    // Phase 1: Bounded Manipulation Task (Happy Path)
    // -------------------------------------------------------------------------
    console.log('\n--- 1. Bounded Manipulation Goal (base_link -> (0.35, -0.15, 0.45)) ---');
    const targetPose = { x: 0.35, y: -0.15, z: 0.45 };
    const transformTimestamp = Date.now();

    console.log(`[invoke] Sending goal with fresh perception transform (age: 0ms)...`);
    const moveResult = await backend.invoke('arm.move_to_pose', {
      target: {
        frame: 'base_link',
        position: targetPose,
      },
      transformAt: transformTimestamp,
    });

    console.log(`[result] Goal completed successfully:`);
    console.log(`  • Success:            ${String(moveResult.success)}`);
    console.log(`  • Reached Position:   ${JSON.stringify(moveResult.position)}`);
    console.log(`  • Frame:              ${String(moveResult.frame)}`);
    console.log(`  • Duration:           ${String(moveResult.durationMs)} ms`);
    console.log(`  • Command Overhead:   ${String(moveResult.commandOverheadMs)} ms`);
    console.log(`  • Physical Evidence:  ${JSON.stringify(moveResult.evidence)}`);
    console.log(`  • Stream Reference:   ${JSON.stringify(moveResult.stream)}`);
    console.log(
      `  • StreamBus Frames:   ${streamFrames.length} high-rate telemetry frames received`,
    );

    // -------------------------------------------------------------------------
    // Phase 2: Frame Safety Check (FRAME_MISSING)
    // -------------------------------------------------------------------------
    console.log('\n--- 2. Frame Safety Gate (Undeclared Frame Rejection) ---');
    try {
      console.log(`[invoke] Attempting move with undeclared frame 'camera_wrist_uncalibrated'...`);
      await backend.invoke('arm.move_to_pose', {
        target: {
          frame: 'camera_wrist_uncalibrated',
          position: { x: 0.2, y: 0.2, z: 0.2 },
        },
      });
    } catch (error) {
      if (error instanceof PinoutStructuredError) {
        console.log(`[rejected] Code: ${error.code} (Category: ${error.category})`);
        console.log(`[message]  ${error.message}`);
      }
    }

    // -------------------------------------------------------------------------
    // Phase 3: Stale Perception Gate (TRANSFORM_STALE)
    // -------------------------------------------------------------------------
    console.log('\n--- 3. Freshness Gate (Stale Transform Rejection) ---');
    try {
      const staleTimestamp = Date.now() - 6000; // 6 seconds old (> 3s limit)
      console.log(`[invoke] Attempting move with 6000ms old transform (maxAge: 3000ms)...`);
      await backend.invoke('arm.move_to_pose', {
        target: {
          frame: 'base_link',
          position: { x: 0.2, y: 0.2, z: 0.2 },
        },
        transformAt: staleTimestamp,
      });
    } catch (error) {
      if (error instanceof PinoutStructuredError) {
        console.log(`[rejected] Code: ${error.code} (Category: ${error.category})`);
        console.log(`[message]  ${error.message}`);
      }
    }

    // -------------------------------------------------------------------------
    // Phase 4: Independent Stop (arm.stop) Mid-Goal
    // -------------------------------------------------------------------------
    console.log('\n--- 4. Independent Halt (arm.stop Mid-Trajectory) ---');
    const movePromise = backend.invoke('arm.move_to_pose', {
      target: {
        frame: 'base_link',
        position: { x: 0.8, y: 0.8, z: 0.8 },
      },
      transformAt: Date.now(),
    });

    await delay(10);
    console.log(`[invoke] Commanding independent stop while trajectory in flight...`);
    const stopResult = await backend.invoke('arm.stop', {});
    console.log(`[result] Stop outcome:`, stopResult);

    await movePromise.catch((err) => {
      console.log(
        `[goal]   In-flight goal aborted cleanly: ${err instanceof Error ? err.message : String(err)}`,
      );
    });

    // -------------------------------------------------------------------------
    // Phase 5: Controller Loss (requires_reconciliation)
    // -------------------------------------------------------------------------
    console.log('\n--- 5. Controller Loss Mid-Goal (Uncertain Outcome) ---');
    const lossTransport = new FakeRosActionServer({
      motionDelayMs: 60,
      feedbackIntervalMs: 5,
      simulateControllerLossMs: 15,
    });
    const lossBackend = createRos2SidecarBackend({ transport: lossTransport });

    try {
      console.log(`[invoke] Starting goal on controller configured to drop link mid-trajectory...`);
      await lossBackend.invoke('arm.move_to_pose', {
        target: {
          frame: 'base_link',
          position: { x: 0.4, y: 0.4, z: 0.4 },
        },
        transformAt: Date.now(),
      });
    } catch (error) {
      if (error instanceof PinoutStructuredError) {
        console.log(`[uncertain] Code: ${error.code} (Category: ${error.category})`);
        console.log(`[details]   ${JSON.stringify(error.details)}`);
        console.log(`[message]   ${error.message}`);
      }
    } finally {
      await lossBackend.close();
    }

    // -------------------------------------------------------------------------
    // Phase 6: Benchmark with Pre-Declared Task Limits
    // -------------------------------------------------------------------------
    console.log('\n--- 6. In-Process Benchmark with Pre-Declared Limits ---');
    const declaredLimits = {
      maxOverheadP99Ms: 15.0,
      maxStopResponseP99Ms: 30.0,
      minSuccessRate: 1.0,
    };
    console.log('Declared Task Limits:');
    console.log(`  • Max Command Overhead p99:  < ${declaredLimits.maxOverheadP99Ms} ms`);
    console.log(`  • Max Stop Response p99:      < ${declaredLimits.maxStopResponseP99Ms} ms`);
    console.log(
      `  • Minimum Success Rate:       ${(declaredLimits.minSuccessRate * 100).toFixed(0)}%`,
    );

    console.log(`\nExecuting 30 simulated goals and 15 stop cancellations...`);
    const report = await runGoalBenchmark({
      iterations: 30,
      limits: declaredLimits,
      motionDelayMs: 8,
      feedbackIntervalMs: 2,
    });

    console.log(
      '\n================================================================================',
    );
    console.log('                         BENCHMARK RESULTS');
    console.log('================================================================================');
    console.log(`Goals Executed:      ${report.totalGoals}`);
    console.log(`Successful Goals:    ${report.successfulGoals}`);
    console.log(`Success Rate:        ${(report.successRate * 100).toFixed(1)}%`);
    console.log('\nPinout Command Overhead (invoke -> goal dispatch):');
    console.log(`  Min:  ${report.commandOverhead.min.toFixed(2)} ms`);
    console.log(`  p50:  ${report.commandOverhead.p50.toFixed(2)} ms`);
    console.log(`  p95:  ${report.commandOverhead.p95.toFixed(2)} ms`);
    console.log(
      `  p99:  ${report.commandOverhead.p99.toFixed(2)} ms  (Limit: < ${declaredLimits.maxOverheadP99Ms} ms)`,
    );
    console.log(`  Max:  ${report.commandOverhead.max.toFixed(2)} ms`);
    console.log('\nObserved Stop Response (stop requested -> controller confirmed):');
    console.log(`  Min:  ${report.stopResponse.min.toFixed(2)} ms`);
    console.log(`  p50:  ${report.stopResponse.p50.toFixed(2)} ms`);
    console.log(`  p95:  ${report.stopResponse.p95.toFixed(2)} ms`);
    console.log(
      `  p99:  ${report.stopResponse.p99.toFixed(2)} ms  (Limit: < ${declaredLimits.maxStopResponseP99Ms} ms)`,
    );
    console.log(`  Max:  ${report.stopResponse.max.toFixed(2)} ms`);
    console.log(`\nOverall Result:      ${report.passedLimits ? 'PASSED ALL LIMITS' : 'FAILED'}`);
    console.log('================================================================================');
  } finally {
    streamHandle.close();
    await runtime.close();
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => {
  console.error('Demo failed:', error);
  process.exit(1);
});
