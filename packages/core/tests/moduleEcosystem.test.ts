import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  PINOUT_HOME_ENV,
  addDeviceDefinition,
  createRuntimeFromConfig,
  defineModule,
  installModuleFromPath,
  listAvailableModules,
  mergeModulePolicies,
  action,
  policiesFromDeclarative,
  readDevicesFile,
  readModulesIndex,
  resetRuntimeModulesForTests,
  runModuleConformance,
  sensorRead,
  uninstallModule,
} from '@pinout/core';

const repoRoot = resolve(import.meta.dirname, '../../..');
const weirdSensorPath = join(repoRoot, 'examples/external-module/weird-sensor');

describe('module ecosystem', () => {
  let pinoutHome: string;
  const previousHome = process.env[PINOUT_HOME_ENV];

  beforeEach(() => {
    pinoutHome = mkdtempSync(join(tmpdir(), 'pinout-home-'));
    process.env[PINOUT_HOME_ENV] = pinoutHome;
    resetRuntimeModulesForTests();
  });

  afterEach(() => {
    if (previousHome === undefined) {
      delete process.env[PINOUT_HOME_ENV];
    } else {
      process.env[PINOUT_HOME_ENV] = previousHome;
    }
    rmSync(pinoutHome, { recursive: true, force: true });
    resetRuntimeModulesForTests();
  });

  it('defineModule validates duplicate capabilities', () => {
    expect(() =>
      defineModule({
        id: 'acme/demo',
        version: '0.1.0',
        device: { class: 'sensor.custom' },
        capabilities: [
          action({ id: 'status.read', description: 'a' }),
          action({ id: 'status.read', description: 'b' }),
        ],
        createBackend: () => ({
          kind: 'simulated',
          invoke: async () => ({}),
          close: async () => undefined,
          subscribe: () => () => undefined,
        }),
      }),
    ).toThrow(/Duplicate capability/);
  });

  it('installs and lists external module', async () => {
    await installModuleFromPath(weirdSensorPath, { home: pinoutHome });
    const modules = listAvailableModules(pinoutHome);
    expect(modules.some((entry) => entry.id === 'weird-sensor/thermometer')).toBe(true);
  });

  it('rejects duplicate module install', async () => {
    await installModuleFromPath(weirdSensorPath, { home: pinoutHome });
    await expect(
      installModuleFromPath(weirdSensorPath, { home: pinoutHome }),
    ).rejects.toMatchObject({
      code: 'MODULE_ALREADY_INSTALLED',
    });
  });

  it('uninstalls external module', async () => {
    await installModuleFromPath(weirdSensorPath, { home: pinoutHome });
    uninstallModule('weird-sensor/thermometer', pinoutHome);
    const modules = readDevicesFile(undefined, pinoutHome);
    expect(modules.devices).toEqual([]);
  });

  it('bootstraps runtime with external module device', async () => {
    await installModuleFromPath(weirdSensorPath, { home: pinoutHome });
    addDeviceDefinition(
      {
        id: 'sensor-01',
        module: 'weird-sensor/thermometer',
        backend: { type: 'simulated' },
      },
      { home: pinoutHome },
    );
    const { runtime } = await createRuntimeFromConfig({
      home: pinoutHome,
      includeDemoDefaults: true,
    });
    try {
      expect(runtime.hasDevice('sensor-01')).toBe(true);
      expect(runtime.hasDevice('esp32-01')).toBe(true);
      const reading = await runtime.invoke('sensor-01', 'temperature.read', {});
      expect(reading.temperature).toBeTypeOf('number');
    } finally {
      await runtime.close();
    }
  });

  it('merges deployment policies without widening module limits', () => {
    const modulePolicies = policiesFromDeclarative({
      'temperature.set': { constraints: { value: { min: 10, max: 80 } } },
    });
    const deploymentPolicies = policiesFromDeclarative({
      'temperature.set': { constraints: { value: { min: 0, max: 60 } } },
    });
    const merged = mergeModulePolicies(modulePolicies, deploymentPolicies);
    const rule = merged.find(
      (entry) => entry.kind === 'numericRange' && entry.capability === 'temperature.set',
    );
    expect(rule && rule.kind === 'numericRange' ? rule.min : undefined).toBe(10);
    expect(rule && rule.kind === 'numericRange' ? rule.max : undefined).toBe(60);
  });

  it('runs conformance on reference external module', async () => {
    const result = await runModuleConformance(weirdSensorPath);
    expect(result.passed).toBe(true);
  });

  it('gates generated candidates and records integrity metadata', async () => {
    const candidate = join(pinoutHome, 'candidate');
    cpSync(weirdSensorPath, candidate, { recursive: true });
    const manifest = JSON.parse(
      readFileSync(join(candidate, 'pinout.module.json'), 'utf8'),
    ) as Record<string, unknown>;
    manifest.status = 'CANDIDATE';
    manifest.capabilities = ['temperature.read'];
    manifest.simulation = { provided: true };
    writeFileSync(join(candidate, 'pinout.module.json'), `${JSON.stringify(manifest)}\n`);
    await expect(installModuleFromPath(candidate, { home: pinoutHome })).rejects.toThrow(
      /CANDIDATE/,
    );
    await installModuleFromPath(candidate, { home: pinoutHome, allowCandidate: true });
    const record = readModulesIndex(pinoutHome).modules.find((entry) => entry.id === manifest.id);
    expect(record?.status).toBe('CANDIDATE');
    expect(record?.manifestHash).toMatch(/^[a-f0-9]{64}$/);
    expect(record?.contentHash).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe('defineModule scaffold module', () => {
  it('supports minimal sensor module', async () => {
    const module = defineModule({
      id: 'test/scaffold',
      version: '1.0.0',
      device: { class: 'sensor.custom', vendor: 'Test' },
      capabilities: [
        sensorRead('temperature.read', 'temp', {
          type: 'object',
          properties: { temperature: { type: 'number' } },
          required: ['temperature'],
        }),
      ],
      createBackend: () => ({
        kind: 'simulated',
        invoke: async () => ({ temperature: 20 }),
        close: async () => undefined,
        subscribe: () => () => undefined,
      }),
    });
    const backend = module.createSimulatedBackend!({});
    await expect(backend.invoke('temperature.read', {})).resolves.toEqual({ temperature: 20 });
    await backend.close();
  });
});
