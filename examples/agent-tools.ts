/**
 * Print agent tools from a connected device.
 *
 *   npm run example:agent-tools -- --mock
 */
import { openDevice, resolveConnectionOptions } from '@pinout/cli/connection';

const args = parseArgs(process.argv.slice(2));
const device = await openDevice(resolveConnectionOptions(args));

try {
  const tools = device.toAgentTools();
  console.log(JSON.stringify(tools, null, 2));
} finally {
  await device.close();
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
