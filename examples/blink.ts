/**
 * Blink GPIO 2 through Pinout.
 *
 *   npm run example:blink -- --mock
 *   npm run example:blink -- --port /dev/cu.usbserial-10
 */
import { connect, simulatedEsp32 } from '@pinout/core';
import { serialPort } from '@pinout/core/serial';

const args = parseArgs(process.argv.slice(2));
const transport = args.mock ? simulatedEsp32() : serialPort({ path: args.port });

const board = await connect({ transport, timeoutMs: args.timeoutMs });

try {
  console.log(`connected ${board.info.firmware} ${board.info.version}`);
  await board.gpio.write(2, true);
  console.log('gpio 2 high');
  await delay(args.mock ? 50 : 500);
  await board.gpio.write(2, false);
  console.log('gpio 2 low');
} finally {
  await board.close();
}

function parseArgs(argv: string[]): { mock: boolean; port: string; timeoutMs: number } {
  let mock = false;
  let port = process.env.PINOUT_PORT ?? '';
  let timeoutMs = 5000;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--mock') {
      mock = true;
    } else if (arg === '--port') {
      port = argv[index + 1] ?? '';
      index += 1;
    } else if (arg === '--timeout') {
      timeoutMs = Number(argv[index + 1]);
      index += 1;
    }
  }

  if (!mock && !port) {
    throw new Error('Pass --mock or --port <path>.');
  }

  return { mock, port, timeoutMs };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
