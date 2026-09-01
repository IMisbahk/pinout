import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PinoutRuntime, relayModule, registerModule } from '@pinout/core';
import { startDaemon } from '@pinout/daemon';
import { runCli } from '../src/runCli.js';

interface CliHarness {
  run(argv: string[]): Promise<number>;
  lines: string[];
}

function makeHarness(): CliHarness {
  const lines: string[] = [];
  return {
    lines,
    async run(argv: string[]) {
      lines.length = 0;
      // runCli expects full process.argv (node, script, ...args) because
      // commander parses with the default `from: 'node'` semantics.
      return runCli(['node', 'pinout', ...argv], {
        log: (value: unknown) =>
          lines.push(typeof value === 'string' ? value : JSON.stringify(value)),
        error: (message: string) => lines.push(message),
      });
    },
  };
}

let harness: CliHarness;
let journalDir: string;
let closeDaemon: (() => Promise<void>) | undefined;

beforeAll(async () => {
  harness = makeHarness();
  const runtime = new PinoutRuntime();
  registerModule(relayModule);
  await runtime.registerFromModule(relayModule.id, { id: 'relay-cli', simulated: true });
  journalDir = await mkdtemp(join(tmpdir(), 'pinout-cli-'));
  const daemon = await startDaemon(runtime, { port: 0, journalPath: join(journalDir, 'j.jsonl') });
  process.env.PINOUT_URL = `http://127.0.0.1:${daemon.port}`;
  closeDaemon = async () => {
    await daemon.close();
    await runtime.close();
  };
});

afterAll(async () => {
  await closeDaemon?.();
  delete process.env.PINOUT_URL;
  await rm(journalDir, { recursive: true, force: true });
});

describe('CLI daemon commands', () => {
  it('shows daemon status', async () => {
    const code = await harness.run(['daemon', 'status', '--json']);
    expect(code).toBe(0);
    expect(harness.lines.join('\n')).toContain('ok');
  });

  it('halts and resumes through the CLI', async () => {
    const haltCode = await harness.run(['halt', 'cli drill', '--json']);
    expect(haltCode).toBe(0);
    expect(harness.lines.join('\n')).toContain('HALTED');
    const resumeCode = await harness.run(['resume', '--json']);
    expect(resumeCode).toBe(0);
  });

  it('acquires and releases a lease', async () => {
    const acquireCode = await harness.run([
      'lease',
      'acquire',
      'relay-cli',
      '--owner',
      'cli-agent',
      '--json',
    ]);
    if (acquireCode !== 0) console.error('acquire output:', harness.lines.join(' | '));
    expect(acquireCode).toBe(0);

    const listCode = await harness.run(['lease', 'list', '--json']);
    expect(listCode).toBe(0);
    expect(harness.lines.join('\n')).toContain('cli-agent');
  });

  it('lists operations and logs', async () => {
    const opsCode = await harness.run(['operations', '--json']);
    if (opsCode !== 0) console.error('operations output:', harness.lines.join(' | '));
    expect(opsCode).toBe(0);
    const logsCode = await harness.run(['logs', '--limit', '5', '--json']);
    expect(logsCode).toBe(0);
  });

  it('fails cleanly when the daemon is unreachable', async () => {
    const saved = process.env.PINOUT_URL;
    process.env.PINOUT_URL = 'http://127.0.0.1:59999';
    try {
      const code = await harness.run(['daemon', 'status']);
      expect(code).toBe(1);
      expect(harness.lines.join('\n')).toContain('Cannot reach the Pinout daemon');
    } finally {
      if (saved === undefined) delete process.env.PINOUT_URL;
      else process.env.PINOUT_URL = saved;
    }
  });
});
