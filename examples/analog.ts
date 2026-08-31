/**
 * Analog read on GPIO 32.
 *
 *   npm run example:analog -- --mock
 */
import { openDevice, resolveConnectionOptions } from '@pinout/cli/connection';

const args = parseArgs(process.argv.slice(2));
const device = await openDevice(resolveConnectionOptions(args));

try {
  const value = await device.gpio.analogRead(32);
  console.log(`gpio 32 analog ${value}`);
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
