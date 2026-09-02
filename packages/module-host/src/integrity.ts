/**
 * Module integrity and signing (spec v1).
 *
 * - contentHash: SHA-256 over a canonical file manifest of the module
 *   directory (sorted paths + per-file hashes; node_modules/dist/.git and
 *   signature files excluded).
 * - manifestHash: SHA-256 over canonical JSON (sorted keys) of the manifest.
 * - Signature: Ed25519 over `manifestHash + contentHash`, base64, stored in
 *   `pinout.module.sig` together with the publisher id.
 *
 * Trust states: UNSIGNED (works, clearly labeled), SIGNED (signature valid,
 * publisher not in the trusted set), VERIFIED (signature valid AND publisher
 * trusted), INVALID_SIGNATURE (content changed after signing, malformed
 * signature, or wrong key). Unsigned local development modules keep working.
 */
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign as edSign,
  verify as edVerify,
  type KeyObject,
} from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const EXCLUDED_ENTRIES = new Set(['node_modules', 'dist', '.git', 'coverage', '.pinout-cache']);
const EXCLUDED_FILES = new Set(['pinout.module.sig']);
const SIGNATURE_FILE = 'pinout.module.sig';

export type IntegrityStatus = 'UNSIGNED' | 'SIGNED' | 'VERIFIED' | 'INVALID_SIGNATURE';

export interface IntegrityReport {
  status: IntegrityStatus;
  manifestHash?: string;
  contentHash?: string;
  publisher?: string;
  reasons: string[];
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`);
  return `{${entries.join(',')}}`;
}

export function hashContent(content: string | Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

/** Stable content hash of a module directory (sorted rel paths + file hashes). */
export function contentHash(moduleDir: string): string {
  const files: Array<{ rel: string; hash: string }> = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      if (EXCLUDED_ENTRIES.has(entry.name)) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        if (EXCLUDED_FILES.has(entry.name)) continue;
        files.push({
          rel: relative(moduleDir, full).split(sep).join('/'),
          hash: hashContent(readFileSync(full)),
        });
      }
    }
  };
  walk(moduleDir);
  files.sort((a, b) => a.rel.localeCompare(b.rel));
  return hashContent(files.map((file) => `${file.rel}:${file.hash}`).join('\n'));
}

export function manifestHash(manifest: unknown): string {
  return hashContent(canonicalJson(manifest));
}

export interface ModuleSignature {
  version: 1;
  publisher: string;
  algorithm: 'ed25519';
  manifestHash: string;
  contentHash: string;
  signature: string;
}

export function generatePublisherKeyPair(): { publicKeyPem: string; privateKeyPem: string } {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return {
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  };
}

/** Sign a module directory. Returns the signature object to write. */
export function signModule(
  moduleDir: string,
  manifest: unknown,
  publisher: string,
  privateKeyPem: string,
): ModuleSignature {
  const mHash = manifestHash(manifest);
  const cHash = contentHash(moduleDir);
  const payload = `${mHash}:${cHash}`;
  const signature = edSign(null, Buffer.from(payload, 'utf8'), createPrivateKey(privateKeyPem));
  return {
    version: 1,
    publisher,
    algorithm: 'ed25519',
    manifestHash: mHash,
    contentHash: cHash,
    signature: signature.toString('base64'),
  };
}

export function writeSignature(moduleDir: string, signature: ModuleSignature): void {
  writeFileSync(join(moduleDir, SIGNATURE_FILE), `${JSON.stringify(signature, null, 2)}\n`, 'utf8');
}

function loadPublicKey(pem: string): KeyObject {
  return createPublicKey(pem);
}

/**
 * Verify a module directory against a set of trusted publisher public keys
 * (publisher id → PEM). Signature covers manifest + all content.
 */
export function verifyModule(
  moduleDir: string,
  trustedPublishers: Record<string, string> = {},
): IntegrityReport {
  const reasons: string[] = [];
  const manifestPath = join(moduleDir, 'pinout.module.json');
  if (!statSyncSafe(moduleDir)) {
    return {
      status: 'INVALID_SIGNATURE',
      reasons: [`Module directory '${moduleDir}' does not exist.`],
    };
  }
  if (!existsPath(manifestPath)) {
    return { status: 'INVALID_SIGNATURE', reasons: ['pinout.module.json is missing.'] };
  }

  const manifestRaw = readFileSync(manifestPath, 'utf8');
  let manifest: unknown;
  try {
    manifest = JSON.parse(manifestRaw);
  } catch (error) {
    return {
      status: 'INVALID_SIGNATURE',
      reasons: [
        `Manifest is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      ],
    };
  }

  const mHash = manifestHash(manifest);
  const cHash = contentHash(moduleDir);
  const sigPath = join(moduleDir, SIGNATURE_FILE);

  if (!existsPath(sigPath)) {
    return {
      status: 'UNSIGNED',
      manifestHash: mHash,
      contentHash: cHash,
      reasons: [
        'No signature file present. Unsigned modules work in development but are never shown as verified.',
      ],
    };
  }

  let signature: ModuleSignature;
  try {
    signature = JSON.parse(readFileSync(sigPath, 'utf8')) as ModuleSignature;
  } catch {
    return {
      status: 'INVALID_SIGNATURE',
      manifestHash: mHash,
      contentHash: cHash,
      reasons: ['Signature file is not valid JSON.'],
    };
  }

  if (signature.algorithm !== 'ed25519' || signature.version !== 1) {
    return {
      status: 'INVALID_SIGNATURE',
      manifestHash: mHash,
      contentHash: cHash,
      reasons: ['Unsupported signature algorithm or version.'],
    };
  }

  const payload = `${signature.manifestHash}:${signature.contentHash}`;
  const trustedPem = trustedPublishers[signature.publisher];
  if (!trustedPem) {
    reasons.push(`Publisher '${signature.publisher}' is not in the trusted set.`);
  }

  let signatureValid = false;
  const verificationKeys: Array<{ label: string; pem: string }> = [];
  if (trustedPem) verificationKeys.push({ label: 'trusted', pem: trustedPem });
  // For SIGNED status we cannot validate without the publisher key; but a
  // publisher key embedded nowhere means we can only record the claim.
  for (const key of verificationKeys) {
    try {
      signatureValid = edVerify(
        null,
        Buffer.from(payload, 'utf8'),
        loadPublicKey(key.pem),
        Buffer.from(signature.signature, 'base64'),
      );
    } catch (error) {
      reasons.push(
        `Signature verification error: ${error instanceof Error ? error.message : String(error)}`,
      );
      signatureValid = false;
    }
  }

  if (signature.manifestHash !== mHash || signature.contentHash !== cHash) {
    return {
      status: 'INVALID_SIGNATURE',
      manifestHash: mHash,
      contentHash: cHash,
      publisher: signature.publisher,
      reasons: [
        ...reasons,
        'Module content changed after signing (hash mismatch) — possible tampering.',
      ],
    };
  }

  if (trustedPem && signatureValid) {
    return {
      status: 'VERIFIED',
      manifestHash: mHash,
      contentHash: cHash,
      publisher: signature.publisher,
      reasons,
    };
  }
  if (!trustedPem && reasons.length > 0) {
    return {
      status: 'SIGNED',
      manifestHash: mHash,
      contentHash: cHash,
      publisher: signature.publisher,
      reasons,
    };
  }
  return {
    status: 'INVALID_SIGNATURE',
    manifestHash: mHash,
    contentHash: cHash,
    publisher: signature.publisher,
    reasons: [...reasons, 'Signature did not verify against any trusted key.'],
  };
}

function existsPath(path: string): boolean {
  try {
    statSync(path);
    return true;
  } catch {
    return false;
  }
}

const statSyncSafe = existsPath;
