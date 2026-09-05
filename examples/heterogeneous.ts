/**
 * Heterogeneous hardware runtime demo — ESP32 + robot arm + environmental chamber.
 *
 *   npm run demo:heterogeneous
 *   npm run demo:heterogeneous -- --hardware   # use PINOUT_PORT for ESP32
 */
import {
  PolicyConstraintViolation,
  PolicyPreconditionFailed,
  createHeterogeneousRuntime,
  defaultHeterogeneousDeviceIds,
  esp32DefaultLedPin,
  loadPinoutConfig,
} from '@pinout/core';

const ids = defaultHeterogeneousDeviceIds;
const useHardware = process.argv.includes('--hardware');
const config = loadPinoutConfig();

const runtime = await createHeterogeneousRuntime({
  useHardwareEsp32: useHardware && Boolean(config.port),
  motionDelayMs: 1,
});

const events: Array<{ deviceId: string; event: string; payload: Record<string, unknown> }> = [];
runtime.on((envelope) => {
  events.push({ deviceId: envelope.deviceId, event: envelope.event, payload: envelope.payload });
  console.log(`[event] ${envelope.deviceId} ${envelope.event} ${JSON.stringify(envelope.payload)}`);
});

console.log('=== Registered devices ===');
printDeviceTable();

console.log('\n=== SOS blink on ESP32 (simulator) ===');
await runtime.invoke(ids.esp32, 'sys.arm', {});
const sos = [
  true,
  false,
  true,
  false,
  true,
  false,
  true,
  true,
  true,
  false,
  false,
  false,
  true,
  false,
  true,
  false,
  true,
  false,
  true,
];
for (const level of sos) {
  await runtime.invoke(ids.esp32, 'gpio.write', { pin: esp32DefaultLedPin, value: level });
}

console.log('\n=== Robot arm: home ===');
await runtime.invoke(ids.arm, 'motion.home', {});

console.log('\n=== Chamber: close door, set 40°C, start experiment ===');
await runtime.invoke(ids.chamber, 'door.close', {});
await runtime.invoke(ids.chamber, 'temperature.set', { value: 40 });
await runtime.invoke(ids.chamber, 'experiment.start', {});

console.log('\n=== Policy denials (expected) ===');
await expectPolicyFailure(
  () => runtime.invoke(ids.chamber, 'temperature.set', { value: 200 }),
  PolicyConstraintViolation,
  '200°C',
);
await runtime.invoke(ids.chamber, 'door.open', {});
await expectPolicyFailure(
  () => runtime.invoke(ids.chamber, 'experiment.start', {}),
  PolicyPreconditionFailed,
  'door',
);
await runtime.invoke(ids.chamber, 'door.close', {});

await expectPolicyFailure(
  () => runtime.invoke(ids.arm, 'motion.move_to', { x: 2, y: 0, z: 0.5 }),
  PolicyConstraintViolation,
  'workspace',
);

console.log('\n=== Final device states ===');
printDeviceTable();
for (const id of [ids.esp32, ids.arm, ids.chamber]) {
  const state = runtime.getDevice(id).getOperationalStateSnapshot();
  console.log(`${id}: ${JSON.stringify(state)}`);
}

console.log(`\nCaptured ${events.length} runtime events.`);
await runtime.close();

function printDeviceTable(): void {
  console.log('ID'.padEnd(20), 'CLASS'.padEnd(28), 'STATUS');
  for (const device of runtime.devices()) {
    console.log(device.id.padEnd(20), device.deviceClass.padEnd(28), device.lifecycle);
  }
}

async function expectPolicyFailure(
  action: () => Promise<unknown>,
  ErrorType: new (...args: never[]) => Error & { code: string },
  hint: string,
): Promise<void> {
  try {
    await action();
    throw new Error(`Expected policy failure containing '${hint}'.`);
  } catch (error) {
    if (!(error instanceof ErrorType)) {
      throw error;
    }
    console.log(`denied (${error.code}): ${error.message}`);
  }
}
