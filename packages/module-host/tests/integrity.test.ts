import { mkdtemp, rm, writeFile, mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  contentHash,
  generatePublisherKeyPair,
  manifestHash,
  signModule,
  verifyModule,
  writeSignature,
} from '../src/index.js';

describe('module integrity', () => {
  let dir: string;
  let publisherKeys: { publicKeyPem: string; privateKeyPem: string };

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'pinout-integrity-'));
    publisherKeys = generatePublisherKeyPair();
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function makeModule(name: string): Promise<string> {
    const moduleDir = join(dir, name);
    await mkdir(moduleDir, { recursive: true });
    await writeFile(
      join(moduleDir, 'pinout.module.json'),
      JSON.stringify(
        { schemaVersion: '1', id: `test/${name}`, version: '0.1.0', runtime: 'node' },
        null,
        2,
      ),
    );
    await writeFile(join(moduleDir, 'index.js'), 'export default { invoke: async () => ({}) };\n');
    return moduleDir;
  }

  it('reports UNSIGNED for a module without a signature (and it stays usable)', async () => {
    const moduleDir = await makeModule('unsigned');
    const report = verifyModule(moduleDir, {});
    expect(report.status).toBe('UNSIGNED');
    expect(report.reasons.join(' ')).toContain('never shown as verified');
    expect(report.manifestHash).toBeDefined();
    expect(report.contentHash).toBeDefined();
  });

  it('sign → VERIFIED with a trusted publisher', async () => {
    const moduleDir = await makeModule('signed');
    const manifest = JSON.parse(await readFile(join(moduleDir, 'pinout.module.json'), 'utf8'));
    const signature = signModule(moduleDir, manifest, 'pinoutlabs', publisherKeys.privateKeyPem);
    writeSignature(moduleDir, signature);

    const verified = verifyModule(moduleDir, { pinoutlabs: publisherKeys.publicKeyPem });
    expect(verified.status).toBe('VERIFIED');
    expect(verified.publisher).toBe('pinoutlabs');

    const signedOnly = verifyModule(moduleDir, {});
    expect(signedOnly.status).toBe('SIGNED');
    expect(signedOnly.reasons.join(' ')).toContain('not in the trusted set');
  });

  it('detects tampering: any content change invalidates the signature', async () => {
    const moduleDir = await makeModule('tampered');
    const manifest = JSON.parse(await readFile(join(moduleDir, 'pinout.module.json'), 'utf8'));
    writeSignature(
      moduleDir,
      signModule(moduleDir, manifest, 'pinoutlabs', publisherKeys.privateKeyPem),
    );

    await writeFile(
      join(moduleDir, 'index.js'),
      'export default { invoke: async () => ({ hacked: true }) };\n',
    );
    const report = verifyModule(moduleDir, { pinoutlabs: publisherKeys.publicKeyPem });
    expect(report.status).toBe('INVALID_SIGNATURE');
    expect(report.reasons.join(' ')).toContain('tampering');
  });

  it('content hash is stable across runs and changes with content', async () => {
    const moduleDir = await makeModule('stable');
    const first = contentHash(moduleDir);
    const second = contentHash(moduleDir);
    expect(first).toBe(second);
    await writeFile(join(moduleDir, 'index.js'), 'export default 42;\n');
    expect(contentHash(moduleDir)).not.toBe(first);
  });

  it('manifest hash is canonical: key order does not matter', () => {
    const a = manifestHash({ id: 'x', version: '1', runtime: 'node' });
    const b = manifestHash({ runtime: 'node', id: 'x', version: '1' });
    expect(a).toBe(b);
  });

  it('rejects malformed manifests and missing directories', async () => {
    const moduleDir = join(dir, 'broken');
    await mkdir(moduleDir, { recursive: true });
    await writeFile(join(moduleDir, 'pinout.module.json'), '{not json');
    expect(verifyModule(moduleDir, {}).status).toBe('INVALID_SIGNATURE');
    expect(verifyModule(join(dir, 'missing'), {}).status).toBe('INVALID_SIGNATURE');
  });
});
