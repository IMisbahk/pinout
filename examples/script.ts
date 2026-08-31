/**
 * Run a Pinout action script on one persistent connection.
 *
 *   npm run example:script -- --mock
 *
 * Inline NDJSON:
 *   npm run example:script -- --mock --script '{"action":"gpio.write","payload":{"pin":2,"value":true}}'
 */
import { openDevice, resolveConnectionOptions } from '@pinout/cli/connection';
import { readScriptSteps, runScript } from '@pinout/cli/script';

const args = parseArgs(process.argv.slice(2));
const options = resolveConnectionOptions(args);
const steps = args.script
  ? await readScriptSteps(args.script)
  : await readScriptSteps(defaultScript);

const device = await openDevice(options);
try {
  const results = await runScript(device, steps);
  for (const entry of results) {
    console.log(`${entry.action}: ${JSON.stringify(entry.result)}`);
  }
} finally {
  await device.close();
}

const defaultScript = `
{"action":"gpio.write","payload":{"pin":2,"value":true}}
{"action":"gpio.read","payload":{"pin":2}}
`.trim();

function parseArgs(argv: string[]): {
  mock?: boolean;
  port?: string;
  baud?: number;
  timeout?: number;
  script?: string;
} {
  let mock = false;
  let port: string | undefined;
  let baud: number | undefined;
  let timeout: number | undefined;
  let script: string | undefined;

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
    } else if (arg === '--script') {
      script = argv[index + 1];
      index += 1;
    }
  }

  return { mock, port, baud, timeout, script };
}
