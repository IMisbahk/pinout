/**
 * Robotics parts workbench — ESP32 + arm + chamber + actuators + sensors + mobile base.
 *
 *   npm run demo:robotics
 */
import {
  PolicyConstraintViolation,
  createRoboticsWorkbench,
  defaultRoboticsDeviceIds,
} from '@pinout/core';

const ids = defaultRoboticsDeviceIds;

const runtime = await createRoboticsWorkbench({ motionDelayMs: 1 });

console.log('=== Robotics workbench devices ===');
printDeviceTable();

console.log('\n=== Actuators ===');
await runtime.invoke(ids.motor, 'motor.set', { speed: 0.4 });
await runtime.invoke(ids.servo, 'servo.set_angle', { angle: 45 });
await runtime.invoke(ids.stepper, 'stepper.step', { steps: 200 });

console.log('\n=== Sensors ===');
const range = await runtime.invoke(ids.distance, 'distance.read', {});
const imu = await runtime.invoke(ids.imu, 'imu.read', {});
const encoder = await runtime.invoke(ids.encoder, 'encoder.read', {});
const limit = await runtime.invoke(ids.limit, 'limit.read', {});
const force = await runtime.invoke(ids.force, 'force.read', {});
console.log(
  `range=${range.meters}m imu.z=${(imu.accel as { z: number }).z}g ticks=${encoder.ticks}`,
);
console.log(`limit.triggered=${limit.triggered} force=${force.newtons}N`);

console.log('\n=== Mobile base ===');
await runtime.invoke(ids.base, 'drive.set_velocity', { linear: 0.3, angular: 0.1 });
const pose = await runtime.invoke(ids.base, 'pose.read', {});
console.log(`pose ${JSON.stringify(pose)}`);
await runtime.invoke(ids.base, 'drive.stop', {});

console.log('\n=== Policy denial (expected) ===');
try {
  await runtime.invoke(ids.base, 'drive.set_velocity', { linear: 9, angular: 0 });
  throw new Error('Expected policy failure for 9 m/s.');
} catch (error) {
  if (!(error instanceof PolicyConstraintViolation)) {
    throw error;
  }
  console.log(`denied (${error.code}): ${error.message}`);
}

console.log('\n=== Final device states ===');
printDeviceTable();
await runtime.close();

function printDeviceTable(): void {
  console.log('ID'.padEnd(20), 'CLASS'.padEnd(28), 'STATUS');
  for (const device of runtime.devices()) {
    console.log(device.id.padEnd(20), device.deviceClass.padEnd(28), device.lifecycle);
  }
}
