import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runCli } from '../src/runCli.js';

const repoRoot = resolve(import.meta.dirname, '../../..');
const weirdSensorPath = join(repoRoot, 'examples/external-module/weird-sensor');

describe('pinout home CLI', () => {
  let pinoutHome: string;
  let io: {
    logs: string[];
    errors: string[];
    log: (m: string) => void;
    error: (m: string) => void;
  };
  const previousHome = process.env.PINOUT_HOME;

  beforeEach(() => {
    pinoutHome = mkdtempSync(join(tmpdir(), 'pinout-cli-home-'));
    process.env.PINOUT_HOME = pinoutHome;
    io = {
      logs: [],
      errors: [],
      log: (message) => io.logs.push(message),
      error: (message) => io.errors.push(message),
    };
  });

  afterEach(() => {
    if (previousHome === undefined) {
      delete process.env.PINOUT_HOME;
    } else {
      process.env.PINOUT_HOME = previousHome;
    }
    rmSync(pinoutHome, { recursive: true, force: true });
  });

  it('lists modules including built-ins', async () => {
    const code = await runCli(['node', 'pinout', 'module', 'list'], io);
    expect(code).toBe(0);
    expect(io.logs.some((line) => line.includes('pinout/esp32'))).toBe(true);
  });

  it('installs external module and registers device', async () => {
    expect(await runCli(['node', 'pinout', 'module', 'install', weirdSensorPath], io)).toBe(0);
    expect(
      await runCli(
        [
          'node',
          'pinout',
          'device',
          'add',
          'sensor-01',
          '--module',
          'weird-sensor/thermometer',
          '--simulated',
        ],
        io,
      ),
    ).toBe(0);
    expect(await runCli(['node', 'pinout', 'devices'], io)).toBe(0);
    expect(io.logs.some((line) => line.includes('sensor-01'))).toBe(true);
  });

  it('invokes external module capability', async () => {
    await runCli(['node', 'pinout', 'module', 'install', weirdSensorPath], io);
    await runCli(
      [
        'node',
        'pinout',
        'device',
        'add',
        'sensor-01',
        '--module',
        'weird-sensor/thermometer',
        '--simulated',
      ],
      io,
    );
    io.logs = [];
    const code = await runCli(
      ['node', 'pinout', 'invoke', 'sensor-01', 'temperature.read', '--payload', '{}'],
      io,
    );
    expect(code).toBe(0);
    expect(io.logs.some((line) => line.includes('temperature'))).toBe(true);
  });
});
