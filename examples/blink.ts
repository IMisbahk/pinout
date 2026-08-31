/**
 * Blink GPIO 2 through Pinout.
 *
 *   npm run example:blink -- --mock
 *   npm run example:blink -- --port /dev/cu.usbserial-10
 */
import { openDevice, resolveConnectionOptions } from '@pinout/cli/connection';

const args = parseArgs(process.argv.slice(2));
const options = resolveConnectionOptions(args);
const board = await openDevice(options);

try {
  console.log(`connected ${board.info.firmware} ${board.info.version}`);
  await board.gpio.write(2, true);
  console.log('gpio 2 high');
  await delay(options.mock ? 50 : 500);
  await board.gpio.write(2, false);
  console.log('gpio 2 low');
} finally {
  await board.close();
}

function parseArgs(argv: string[]): {
  mock?: boolean;
  port?: string;
  baud?: number;
  timeout?: number;
} {
  let mock = false;
  let port: string | undefined;
  let baud: number | undefined;
  let timeout: number | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--mock') {
      mock = true;
    } else if (arg === '--port') {
      port = argv[index + 1];
      index += 1;
    } else if (arg === '--baud') {
      baud = Number(argv[index + 1]);
      index += 1;
    } else if (arg === '--timeout') {
      timeout = Number(argv[index + 1]);
      index += 1;
    }
  }

  return { mock, port, baud, timeout };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
