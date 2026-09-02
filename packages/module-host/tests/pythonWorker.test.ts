import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ModuleHost, ModuleCrashedError } from '../src/index.js';
import type { ModuleProcess } from '../src/index.js';
import type { ChildProcess } from 'node:child_process';

const python3Available = (): boolean => {
  try {
    execFileSync('python3', ['--version'], { stdio: 'ignore' });
    return true;
  } catch (error) {
    console.log('python3 detection failed:', (error as Error).message.slice(0, 120));
    return false;
  }
};
const available = python3Available();
console.log('PY AVAILABLE:', available);

const repoRoot = process.cwd();
const pythonModuleSdk = join(repoRoot, 'sdk', 'python-module', 'src');
const heatlamp = join(repoRoot, 'sdk', 'python-module', 'examples', 'heatlamp', 'heatlamp.py');

describe.skipIf(!available)('ModuleHost: python worker', () => {
  let host: ModuleHost;
  let processHandle: ModuleProcess;

  beforeAll(async () => {
    process.env.PYTHONPATH = pythonModuleSdk;
    host = new ModuleHost();
    processHandle = host.spawn({
      id: 'heatlamp',
      runtime: 'python',
      modulePath: heatlamp,
      config: { maxTemperature: 40, initialTemperature: 20 },
      heartbeatIntervalMs: 500,
      restart: { maxRestarts: 1, backoffMs: 50 },
    });
    await processHandle.start();
  });

  afterAll(async () => {
    await host.shutdownAll();
    delete process.env.PYTHONPATH;
  });

  it('registers like a TS module: ready with declared capabilities', () => {
    expect(processHandle.state()).toBe('ready');
    expect(processHandle.capabilities()).toEqual(
      expect.arrayContaining(['lamp.on', 'lamp.off', 'lamp.status']),
    );
  });

  it('invokes capabilities with correlated results', async () => {
    const on = await processHandle.invoke('lamp.on', {});
    expect(on).toMatchObject({ on: true });
    const status = await processHandle.invoke('lamp.status', {});
    expect(status.on).toBe(true);
    expect(typeof status.temperature).toBe('number');
  });

  it('forwards module events to host subscribers', async () => {
    const events: Array<[string, Record<string, unknown>]> = [];
    const unsubscribe = processHandle.onEvent((event, data) => events.push([event, data]));
    await processHandle.invoke('lamp.force_overheat_event', {});
    await new Promise((resolve) => setTimeout(resolve, 150));
    unsubscribe();
    const overheat = events.find(([event]) => event === 'lamp.overtemperature');
    expect(overheat).toBeDefined();
    expect(overheat![1]).toMatchObject({ limit: 40 });
  });

  it('structured errors cross the IPC boundary', async () => {
    await expect(processHandle.invoke('lamp.explode', {})).rejects.toMatchObject({
      code: 'UNSUPPORTED_CAPABILITY',
      category: 'MODULE',
    });
  });

  it('crash detection: a SIGKILLed python worker transitions out of ready and the host survives', async () => {
    const crashing = host.spawn({
      id: 'heatlamp-crashy',
      runtime: 'python',
      modulePath: heatlamp,
      config: {},
      heartbeatIntervalMs: 500,
      restart: { maxRestarts: 0, backoffMs: 10 },
    });
    await crashing.start();
    const child = (crashing as unknown as { child?: import('node:child_process').ChildProcess })
      .child;
    if (child) {
      try {
        child.kill('SIGKILL');
      } catch {
        // already gone
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(['dead', 'restarting', 'starting']).toContain(crashing.state());
    await expect(crashing.invoke('lamp.on', {})).rejects.toThrowError();
  }, 10_000);

  it('python crash error type is structured for callers', () => {
    const error = new ModuleCrashedError('p', 'exited (code 1)');
    expect(error.code).toBe('MODULE_CRASHED');
    expect(error.retryable).toBe(true);
  });
});
