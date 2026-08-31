/**
 * PWM on GPIO 2.
 *
 *   npm run example:pwm -- --mock
 */
import { openDevice, resolveConnectionOptions } from '@pinout/cli/connection';

const args = parseArgs(process.argv.slice(2));
const device = await openDevice(resolveConnectionOptions(args));

try {
  await device.gpio.pwm(0, 2, 0.25, 1000);
  console.log('pwm gpio 2 duty 0.25');
  await delay(args.mock ? 20 : 500);
  await device.gpio.pwm(0, 2, 0, 1000);
  console.log('pwm stopped');
} finally {
  await device.close();
}

function parseArgs(argv: string[]): { mock?: boolean; port?: string } {
  let mock = false;
  let port: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--mock') {
      mock = true;
    } else if (arg === '--port') {
      port = argv[index + 1];
      index += 1;
    }
  }
  return { mock, port };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
