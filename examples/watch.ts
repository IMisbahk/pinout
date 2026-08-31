/**
 * Watch GPIO 2 for gpio.changed events.
 *
 *   npm run example:watch -- --mock
 */
import { openDevice, resolveConnectionOptions } from '@pinout/cli/connection';

const args = parseArgs(process.argv.slice(2));
const device = await openDevice(resolveConnectionOptions(args));

try {
  device.on('gpio.changed', (payload) => {
    console.log(`gpio.changed ${JSON.stringify(payload)}`);
  });
  await device.gpio.watch(2);
  await device.gpio.write(2, true);
  await delay(args.mock ? 20 : 200);
  await device.gpio.unwatch(2);
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
