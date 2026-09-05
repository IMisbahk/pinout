/**
 * Commissioned Lamp Module Example over Modbus TCP simulator.
 *
 * Demonstrates:
 * 1. Modbus coil actuation (coil 0) with independent discrete input readback (discrete input 1).
 * 2. Explicit arming with documented host-loss watchdog limitation (`requireWatchdog: false`).
 * 3. Semantic actuation: `lamp.on`, `lamp.off`, `lamp.status`.
 * 4. Multi-stage evidence model:
 *    • Commanded (host intent)
 *    • Acknowledged (Modbus coil write confirmation)
 *    • Observed (independent Modbus discrete input sensor readback)
 *    • Freshness, provenance ('simulated'), and armed state.
 * 5. Honest disagreement reporting (observed sensor feedback vs commanded coil).
 * 6. Explicit disarming (`lamp.disarm`) enforcing the commissioned fail-safe electrical state.
 *
 * Usage:
 *   npx tsx examples/lamp-modbus.ts
 */
import { createModbusLampBackend, type ModbusLampBackend } from '@pinout/protocols-modbus';
import type { LampStatus } from '@pinout/core';

async function main(): Promise<void> {
  console.log(
    '[lamp-modbus-example] Initializing Modbus Lamp Backend over in-process simulator...',
  );

  const backend: ModbusLampBackend = await createModbusLampBackend({
    coil: 0,
    discreteInput: 1,
    polarity: 'active-high',
    safeLevel: 'low',
    readbackPolarity: 'active-high',
    requireWatchdog: false,
    provenance: 'simulated',
  });

  try {
    // 1. Inspect initial status (disarmed by default)
    const initialStatus = (await backend.invoke('lamp.status', {})) as LampStatus;
    console.log('\n--- 1. Initial Lamp Status (Disarmed at Boot) ---');
    console.log(JSON.stringify(initialStatus, null, 2));

    // 2. Explicitly arm the lamp
    console.log('\n[lamp-modbus-example] Explicitly arming lamp via lamp.arm...');
    const armResult = await backend.invoke('lamp.arm', { timeoutMs: 5000 });
    console.log(`[lamp-modbus-example] lamp.arm result:`, armResult);

    const armedStatus = (await backend.invoke('lamp.status', {})) as LampStatus;
    console.log('\n--- 2. Status After lamp.arm ---');
    console.log(JSON.stringify(armedStatus, null, 2));

    // 3. Turn the lamp ON
    console.log('\n[lamp-modbus-example] Invoking lamp.on...');
    const onResult = await backend.invoke('lamp.on', {});
    console.log(`[lamp-modbus-example] lamp.on result:`, onResult);

    // 4. Inspect status while ON
    const onStatus = (await backend.invoke('lamp.status', {})) as LampStatus;
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

    // 5. Demonstrate simulated wiring fault: discrete input disconnected or lamp failed
    console.log(
      '\n[lamp-modbus-example] Simulating wiring/sensor fault (discrete input reading FALSE while coil is ON)...',
    );
    backend.setSimulatedReadbackLevel(false);
    const faultStatus = (await backend.invoke('lamp.status', {})) as LampStatus;
    console.log(
      `Fault status (no auto-correction):\n` +
        `  • Commanded:    ${String(faultStatus.commanded.on)}\n` +
        `  • Acknowledged: ${String(faultStatus.acknowledged.on)}\n` +
        `  • Observed:     ${String(faultStatus.observed.on)} (disagreement preserved honestly)`,
    );

    await delay(100);

    // 6. Turn the lamp OFF
    console.log('\n[lamp-modbus-example] Invoking lamp.off...');
    const offResult = await backend.invoke('lamp.off', {});
    console.log(`[lamp-modbus-example] lamp.off result:`, offResult);

    // 7. Explicitly disarm the lamp
    console.log('\n[lamp-modbus-example] Explicitly disarming lamp via lamp.disarm...');
    const disarmResult = await backend.invoke('lamp.disarm', {});
    console.log(`[lamp-modbus-example] lamp.disarm result:`, disarmResult);

    // 8. Inspect status after disarm
    const finalStatus = (await backend.invoke('lamp.status', {})) as LampStatus;
    console.log('\n--- 4. Status After lamp.disarm ---');
    console.log(JSON.stringify(finalStatus, null, 2));

    console.log('\n[lamp-modbus-example] Demo completed successfully.');
  } finally {
    await backend.close();
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

main().catch((error) => {
  console.error('[lamp-modbus-example] Failed:', error);
  process.exit(1);
});
