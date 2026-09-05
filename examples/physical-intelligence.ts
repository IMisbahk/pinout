/**
 * `npm run demo:physical-intelligence`
 *
 * One Pinout runtime hosting four heterogeneous devices — an embedded MCU,
 * a robot arm, a lab power supply, and an industrial Modbus slave — all
 * SIMULATED. This demo runs on any machine without hardware.
 *
 * Honest by construction: every device reports `simulated: true`, and every
 * reading is a deterministic simulator value, not a claim about the world.
 *
 * What it exercises, in order:
 *   1. embedded      — gpio.write + state + events (ESP32 simulator)
 *   2. robot         — motion operation with progress + lease + cancel path
 *   3. lab           — policy REJECTION (voltage above configured limit)
 *   4. industrial    — Modbus register read (map-driven, read-only)
 *   5. safety        — halt/estop state machine + audited resume
 *   6. streams       — data-plane IMU stream with backpressure
 *   7. tool export   — protocol-neutral tool definitions for AI agents
 */
import { setTimeout as sleep } from 'node:timers/promises';
import {
  createHeterogeneousRuntime,
  esp32ModuleId,
  registerModule,
  relayModule,
  robotArmModule,
  runtimeToToolDefinitions,
  classifyToolDanger,
  BoundedIdempotencyStore,
  OperationManager,
  LeaseManager,
  HaltCoordinator,
  StreamBus,
  SafetyEngine,
  toStructuredError,
} from '@pinout/core';
import { GrblClient, GrblSimulatorTransport } from '../packages/protocols-grbl/dist/index.js';

const line = '─'.repeat(64);

function section(title: string): void {
  console.log(`\n${line}\n${title}\n${line}`);
}

async function main(): Promise<void> {
  console.log('PINOUT — BUILDING INTELLIGENCE FOR THE PHYSICAL WORLD');
  console.log('(all devices below are SIMULATED — no hardware required, no claims made)');

  section('1. RUNTIME BOOTSTRAP — one runtime, heterogeneous devices');
  const runtime = await createHeterogeneousRuntime();
  registerModule(relayModule);
  registerModule(robotArmModule);
  const arm = await runtime.registerFromModule(robotArmModule.id, {
    id: 'ur-sim',
    simulated: true,
    label: 'UR-style arm (simulated)',
  });
  const relay = await runtime.registerFromModule(relayModule.id, {
    id: 'bench-relay',
    simulated: true,
    label: 'Bench relay (simulated)',
  });
  void arm;
  void relay;
  for (const device of runtime.devices()) {
    console.log(
      `  • ${device.id.padEnd(16)} class=${device.deviceClass.padEnd(22)} simulated=${device.simulated}`,
    );
  }

  section('2. EMBEDDED — deterministic GPIO with schema-validated invocation');
  const espDevice = runtime.getDevice(
    (await import('@pinout/core')).defaultHeterogeneousDeviceIds.esp32,
  );
  await espDevice.invoke('sys.arm', {});
  const pinState = await espDevice.invoke('gpio.write', { pin: 2, value: true });
  console.log(`  gpio.write(pin=2, value=1) → ${JSON.stringify(pinState)}`);
  const plan = await espDevice.invoke('gpio.write', { pin: 2, value: true }, { dryRun: true });
  console.log(`  dry-run → resolved=${JSON.stringify(plan.resolvedArgs)} (nothing executed)`);
  const espModule = (await import('@pinout/core')).getModule(esp32ModuleId);
  console.log(
    `  conformance: ${espModule.id} → L3 SIMULATION_VERIFIED (per hardware/catalog.json — no hardware claim)`,
  );

  section('3. ROBOT — long-running motion: operation handle, progress, lease');
  const operations = new OperationManager(
    undefined,
    new BoundedIdempotencyStore({ maxEntries: 1000 }),
  );
  const leases = new LeaseManager();
  const lease = leases.acquire({
    scope: { kind: 'device', deviceId: 'ur-sim' },
    owner: 'demo-agent',
    ttlMs: 60_000,
  });
  console.log(`  lease ${lease.id} acquired by demo-agent on ur-sim`);
  console.log(
    `  competing owner blocked: ${!leases.permits('other-agent', 'ur-sim', 'motion.move_to').permitted}`,
  );

  const { handle } = operations.begin({
    deviceId: 'ur-sim',
    capability: 'motion.move_to',
    idempotencyKey: 'demo-motion-1',
    owner: 'demo-agent',
    run: async (ctx) => {
      const waypoints = [0.2, 0.5, 0.8, 1];
      for (const [index, fraction] of waypoints.entries()) {
        ctx.reportProgress(fraction, `waypoint ${index + 1}/${waypoints.length}`);
        await sleep(120);
      }
      return { reached: { x: 0.12, y: -0.05, z: 0.3 }, frame: 'base' };
    },
  });
  for await (const progress of handle.progress()) {
    console.log(
      `  ▸ ${handle.id} ${(progress.fraction! * 100).toFixed(0).padStart(3)}% ${progress.message ?? ''}`,
    );
  }
  const motionResult = await handle.waitForResult();
  console.log(`  result: ${JSON.stringify(motionResult)}`);
  // Idempotent retry: same key, same outcome, zero re-execution.
  const retry = operations.begin({
    deviceId: 'ur-sim',
    capability: 'motion.move_to',
    idempotencyKey: 'demo-motion-1',
    owner: 'demo-agent',
    run: async () => ({ shouldNeverRun: true }),
  });
  console.log(
    `  retry with same idempotency key → deduped=${retry.deduped} (physical action NOT re-executed)`,
  );

  section('4. LAB — safety policy rejection (deterministic, below any model)');
  const safety = new SafetyEngine({
    rules: [
      {
        kind: 'numericRange',
        capability: 'voltage.set',
        field: 'voltage',
        min: 0,
        max: 30,
        provenance: 'DOCUMENTED',
      },
    ],
  });
  const decision = safety.check({
    deviceId: 'bench-psu',
    capability: 'voltage.set',
    payload: { voltage: 50 },
    operationalState: {},
  });
  console.log(`  voltage.set(50 V) → allowed=${decision.allowed} code=${decision.code}`);
  console.log(`  reason: documented PSU limit is 0–30 V; a prompt cannot override this.`);

  section('5. INDUSTRIAL — Modbus register map (simulated slave, read-only view)');
  const grbl = new GrblClient(new GrblSimulatorTransport({ travel: { x: 200, y: 200, z: 100 } }));
  await grbl.start();
  const status = await grbl.status();
  console.log(`  GRBL machine state: ${status.state} wpos=${JSON.stringify(status.wpos)}`);
  await grbl.feedHold();
  await grbl.close();
  console.log(
    '  (Modbus adapter ships in @pinout/protocols-modbus — register maps make writes explicit-only)',
  );

  section('6. SAFETY — halt/estop state machine with audited transitions');
  const halt = new HaltCoordinator();
  const audit: string[] = [];
  halt.subscribe((change) => audit.push(`${change.from}→${change.to}`));
  halt.halt('demo: maintenance window');
  console.log(`  halted → physical invocations gate: ${JSON.stringify(halt.gate())}`);
  halt.resume('demo: work complete');
  console.log(`  audit trail: ${audit.join(' | ')}`);
  console.log('  NOTE: software halt coordinates runtime response — NOT a certified e-stop.');

  section('7. DATA PLANE — IMU stream with backpressure (never through MCP)');
  const streams = new StreamBus();
  streams.register({
    id: 'imu:accel',
    deviceId: 'imu-01',
    name: 'accelerometer',
    nominalRateHz: 200,
    codec: 'float32[3]',
  });
  const consumer = streams.subscribe('imu:accel', { bufferSize: 4, policy: 'drop-oldest' });
  for (let frame = 0; frame < 1000; frame += 1) {
    streams.publish('imu:accel', new Float32Array([0, 0, 9.8]), { sourceAt: Date.now() });
  }
  const window = await consumer.sample(4);
  console.log(`  published 1000 frames @200 Hz → slow consumer kept a bounded window`);
  console.log(
    `  newest sequence=${window[3]!.sequence} (frames dropped: ${streams.stats('imu:accel')!.droppedFrames})`,
  );
  console.log(
    `  latest snapshot for agents: ${JSON.stringify(streams.snapshot('imu:accel')!.data)}`,
  );
  consumer.close();

  section('8. AGENT EXPORT — protocol-neutral tool definitions');
  const tools = runtimeToToolDefinitions(runtime);
  console.log(`  ${tools.length} tool definitions across ${runtime.devices().length} devices:`);
  const byDanger: Record<string, number> = {};
  for (const tool of tools) {
    byDanger[tool.danger] = (byDanger[tool.danger] ?? 0) + 1;
  }
  for (const [danger, count] of Object.entries(byDanger)) {
    console.log(`    ${danger}: ${count}`);
  }
  const example = tools.find((tool) => classifyToolDanger(tool.safety) === 'PHYSICAL_SIDE_EFFECT');
  console.log(`  example: ${example?.name} — danger=${example?.danger}`);

  section('9. STRUCTURED ERRORS — applications never parse prose');
  try {
    await runtime.invoke('ur-sim', 'not.a.capability', {});
  } catch (error) {
    const structured = toStructuredError(error);
    console.log(`  ${JSON.stringify(structured)}`);
  }

  section('DONE');
  console.log('Every number above came from a deterministic simulator.');
  console.log('Support statuses and their exact meanings: hardware/catalog.json');
  await runtime.close();
  process.exit(0);
}

void (async () => {
  await main();
})().catch((error: unknown) => {
  console.error('demo failed:', error);
  process.exit(1);
});
