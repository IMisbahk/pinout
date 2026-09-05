/**
 * Commissioned Lamp Module Example over simulated ESP32 transport.
 *
 * Demonstrates:
 * 1. Commissioned pin deployment configuration (active-high on GPIO 2, safe level low, readback on GPIO 13).
 * 2. Explicit arming with host-loss deadman watchdog (`lamp.arm`).
 * 3. Semantic actuation: `lamp.on`, `lamp.off`, `lamp.status`.
 * 4. Multi-stage evidence model: commanded, acknowledged, observed (independent readback), freshness, provenance, and armed state.
 * 5. Explicit disarming (`lamp.disarm`) applying the commissioned safe level.
 *
 * Usage:
 *   npx tsx examples/lamp.ts
 */
import { resolve } from 'node:path';
import { createRuntimeFromConfig } from '@pinout/core';

async function main(): Promise<void> {
  const configPath = resolve(import.meta.dirname, 'lamp.config.json');
  console.log(`[lamp-example] Loading deployment configuration from ${configPath}...`);

  const { runtime } = await createRuntimeFromConfig({
    devicesPath: configPath,
  });

  try {
    const deviceId = 'lamp-01';
    console.log(`[lamp-example] Device '${deviceId}' registered successfully.`);

    // 1. Inspect initial status (disarmed by default)
    const initialStatus = await runtime.invoke(deviceId, 'lamp.status', {});
    console.log('\n--- 1. Initial Lamp Status (Disarmed at Boot) ---');
    console.log(JSON.stringify(initialStatus, null, 2));

    // 2. Explicitly arm the lamp with a watchdog timeout
    console.log('\n[lamp-example] Explicitly arming lamp via lamp.arm...');
    const armResult = await runtime.invoke(deviceId, 'lamp.arm', { timeoutMs: 5000 });
    console.log(`[lamp-example] lamp.arm result:`, armResult);

    const armedStatus = await runtime.invoke(deviceId, 'lamp.status', {});
    console.log('\n--- 2. Status After lamp.arm ---');
    console.log(JSON.stringify(armedStatus, null, 2));

    // 3. Turn the lamp ON
    console.log('\n[lamp-example] Invoking lamp.on...');
    const onResult = await runtime.invoke(deviceId, 'lamp.on', {});
    console.log(`[lamp-example] lamp.on result:`, onResult);

    // 4. Inspect status while ON
    const onStatus = await runtime.invoke(deviceId, 'lamp.status', {});
    console.log('\n--- 3. Status After lamp.on ---');
    console.log(JSON.stringify(onStatus, null, 2));
    console.log(
      `Evidence breakdown:\n` +
        `  • Commanded:    ${String(onStatus.commanded.on)} (at ${String(onStatus.commanded.at)})\n` +
        `  • Acknowledged: ${String(onStatus.acknowledged.on)} (at ${String(onStatus.acknowledged.at)})\n` +
        `  • Observed:     ${String(onStatus.observed.on)} (source: ${String(onStatus.observed.source)})\n` +
        `  • Freshness:    ${String(onStatus.freshnessMs)} ms\n` +
        `  • Provenance:   ${String(onStatus.provenance)}\n` +
        `  • Armed:        ${String(onStatus.armed)}`,
    );

    await delay(200);

    // 5. Turn the lamp OFF
    console.log('\n[lamp-example] Invoking lamp.off...');
    const offResult = await runtime.invoke(deviceId, 'lamp.off', {});
    console.log(`[lamp-example] lamp.off result:`, offResult);

    // 6. Explicitly disarm the lamp
    console.log('\n[lamp-example] Explicitly disarming lamp via lamp.disarm...');
    const disarmResult = await runtime.invoke(deviceId, 'lamp.disarm', {});
    console.log(`[lamp-example] lamp.disarm result:`, disarmResult);

    // 7. Inspect status after disarm
    const finalStatus = await runtime.invoke(deviceId, 'lamp.status', {});
    console.log('\n--- 4. Status After lamp.disarm ---');
    console.log(JSON.stringify(finalStatus, null, 2));

    console.log('\n[lamp-example] Demo completed successfully.');
  } finally {
    await runtime.close();
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

main().catch((error) => {
  console.error('[lamp-example] Failed:', error);
  process.exit(1);
});
