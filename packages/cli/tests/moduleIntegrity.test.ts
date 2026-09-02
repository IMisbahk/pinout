import { mkdtemp, rm, writeFile, mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runCli } from '../src/runCli.js';
import { generatePublisherKeyPair, writeSignature, signModule } from '@pinout/module-host';
import { readFileSync } from 'node:fs';

let dir: string;
let publisherKeys: { publicKeyPem: string; privateKeyPem: string };
let trustedPemPath: string;

async function makeModule(name: string, body: string): Promise<string> {
  const moduleDir = join(dir, name);
  await mkdir(moduleDir, { recursive: true });
  await writeFile(
    join(moduleDir, 'pinout.module.json'),
    JSON.stringify(
      {
        schemaVersion: '1',
        id: `test/${name}`,
        version: '0.1.0',
        runtime: 'node',
        deviceClass: 'sensor.custom',
        permissions: { network: { hosts: ['example.internal'], ports: [4840] } },
      },
      null,
      2,
    ),
  );
  await writeFile(join(moduleDir, 'index.js'), body);
  return moduleDir;
}

async function run(argv: string[]): Promise<{ code: number; lines: string[] }> {
  const lines: string[] = [];
  const code = await runCli(['node', 'pinout', ...argv], {
    log: (value: unknown) => lines.push(typeof value === 'string' ? value : JSON.stringify(value)),
    error: (message: string) => lines.push(message),
  });
  return { code, lines: lines.join('\n').split('\n') };
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'pinout-modint-'));
  publisherKeys = generatePublisherKeyPair();
  trustedPemPath = join(dir, 'publisher.pem');
  await writeFile(trustedPemPath, publisherKeys.publicKeyPem);
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('CLI module integrity commands', () => {
  it('integrity prints the manifest and permissions audit', async () => {
    const moduleDir = await makeModule('plain', 'export default {};\n');
    const { code, lines } = await run(['module', 'integrity', moduleDir]);
    expect(code).toBe(0);
    expect(lines.join('\n')).toContain('PERMISSIONS AUDIT');
    expect(lines.join('\n')).toContain('example.internal');
  });

  it('verify reports UNSIGNED for a development module and exits 0', async () => {
    const moduleDir = await makeModule('unsigned', 'export default {};\n');
    const { code, lines } = await run(['module', 'verify', moduleDir]);
    expect(code).toBe(0);
    expect(lines.join('\n')).toContain('UNSIGNED');
    expect(lines.join('\n')).toContain('never displayed as verified');
  });

  it('verify reports VERIFIED for a signed module with a trusted publisher', async () => {
    const moduleDir = await makeModule('signed', 'export default {};\n');
    const manifest = JSON.parse(await readFile(join(moduleDir, 'pinout.module.json'), 'utf8'));
    writeSignature(
      moduleDir,
      signModule(moduleDir, manifest, 'pinoutlabs', publisherKeys.privateKeyPem),
    );
    void readFileSync; // (kept for parity with node:fs usage above)

    const { code, lines } = await run([
      'module',
      'verify',
      moduleDir,
      '--publisher',
      `pinoutlabs=${trustedPemPath}`,
    ]);
    expect(code).toBe(0);
    expect(lines.join('\n')).toContain('VERIFIED');
  });

  it('verify reports INVALID_SIGNATURE (exit 1) after tampering', async () => {
    const moduleDir = await makeModule('tampered', 'export default {};\n');
    const manifest = JSON.parse(await readFile(join(moduleDir, 'pinout.module.json'), 'utf8'));
    writeSignature(
      moduleDir,
      signModule(moduleDir, manifest, 'pinoutlabs', publisherKeys.privateKeyPem),
    );
    await writeFile(join(moduleDir, 'index.js'), 'export default { hacked: true };\n');

    const { code, lines } = await run([
      'module',
      'verify',
      moduleDir,
      '--publisher',
      `pinoutlabs=${trustedPemPath}`,
    ]);
    expect(code).toBe(1);
    expect(lines.join('\n')).toContain('INVALID_SIGNATURE');
    expect(lines.join('\n')).toContain('tampering');
  });

  it('verify reports SIGNED (exit 0) when the publisher is untrusted', async () => {
    const moduleDir = await makeModule('foreign', 'export default {};\n');
    const manifest = JSON.parse(await readFile(join(moduleDir, 'pinout.module.json'), 'utf8'));
    writeSignature(
      moduleDir,
      signModule(moduleDir, manifest, 'someone-else', publisherKeys.privateKeyPem),
    );
    const { code, lines } = await run([
      'module',
      'verify',
      moduleDir,
      '--publisher',
      `pinoutlabs=${trustedPemPath}`,
    ]);
    expect(code).toBe(0);
    expect(lines.join('\n')).toContain('SIGNED');
    expect(lines.join('\n')).toContain('not in the trusted set');
  });
});
