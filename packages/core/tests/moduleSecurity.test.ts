import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { createRuntimeFromConfig, loadModuleFromDirectory, uninstallModule } from '@pinout/core';
import {
  loadInstalledModule,
  readModulesIndex,
  writeModulesIndex,
} from '../src/home/moduleStore.js';

describe('module loading path security', () => {
  it('rejects an entrypoint that escapes the module directory', async () => {
    const root = mkdtempSync(join(tmpdir(), 'pinout-module-'));
    const moduleDir = join(root, 'module');
    mkdirSync(moduleDir);
    writeFileSync(join(root, 'outside.mjs'), 'export default {};');
    writeFileSync(
      join(moduleDir, 'pinout.module.json'),
      JSON.stringify({
        schemaVersion: 1,
        id: 'test/escape',
        version: '1.0.0',
        deviceClass: 'test.device',
        entrypoint: '../outside.mjs',
      }),
    );
    try {
      await expect(loadModuleFromDirectory(moduleDir)).rejects.toThrow(
        /inside the module directory/,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('refuses tampered index paths before load or uninstall', async () => {
    const home = mkdtempSync(join(tmpdir(), 'pinout-home-security-'));
    const victim = join(home, 'victim.txt');
    writeFileSync(victim, 'keep me');
    writeModulesIndex(
      {
        schemaVersion: 1,
        modules: [
          {
            id: 'evil/module',
            version: '1.0.0',
            deviceClass: 'test.device',
            installPath: victim,
            sourcePath: victim,
            installedAt: new Date().toISOString(),
          },
        ],
      },
      home,
    );
    try {
      expect(readModulesIndex(home).modules[0]?.installPath).toBe(victim);
      expect(() => uninstallModule('evil/module', home)).toThrow(
        /outside the Pinout modules directory/,
      );
      await expect(loadInstalledModule('evil/module', home)).rejects.toThrow(
        /outside the Pinout modules directory/,
      );
      expect(() => rmSync(victim)).not.toThrow();
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('does not load unrelated installed modules during runtime bootstrap', async () => {
    const home = mkdtempSync(join(tmpdir(), 'pinout-home-isolation-'));
    const brokenModule = join(home, 'modules', 'broken--module');
    mkdirSync(brokenModule, { recursive: true });
    writeModulesIndex(
      {
        schemaVersion: 1,
        modules: [
          {
            id: 'broken/module',
            version: '1.0.0',
            deviceClass: 'test.device',
            installPath: brokenModule,
            sourcePath: brokenModule,
            installedAt: new Date().toISOString(),
          },
        ],
      },
      home,
    );
    try {
      const { runtime, errors } = await createRuntimeFromConfig({
        home,
        includeDemoDefaults: true,
        continueOnError: true,
      });
      expect(runtime.hasDevice('esp32-01')).toBe(true);
      expect(runtime.getDevice('esp32-01').simulated).toBe(true);
      expect(errors).toEqual([]);
      await runtime.close();
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
