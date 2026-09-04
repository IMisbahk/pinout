#!/usr/bin/env node

/**
 * Inspect the artifacts that a release would produce without publishing them.
 *
 * The script deliberately does not mutate package versions, create archives, or
 * contact a registry. `--strict` is used by CI and turns release blockers into
 * failures; the default is useful for auditing an in-progress release.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(new URL('..', import.meta.url).pathname);
const args = new Set(process.argv.slice(2));
const versionArgIndex = process.argv.indexOf('--version');
const requestedVersionRaw = versionArgIndex >= 0 ? process.argv[versionArgIndex + 1] : undefined;
const requestedVersion = requestedVersionRaw?.replace(/^v/, '');
const strict = args.has('--strict');
const failures = [];
const warnings = [];

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const packageDirs = readdirSync(join(root, 'packages'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => join(root, 'packages', entry.name))
  .filter((dir) => existsSync(join(dir, 'package.json')));
const manifests = packageDirs.map((dir) => ({
  dir,
  manifest: readJson(join(dir, 'package.json')),
}));
const publicPackages = manifests.filter(({ manifest }) => !manifest.private);

if (publicPackages.length === 0) failures.push('No publishable npm workspace packages were found.');

const publicVersions = new Set(publicPackages.map(({ manifest }) => manifest.version));
if (publicVersions.size > 1) {
  failures.push(
    `Publishable npm packages use inconsistent versions: ${[...publicVersions].join(', ')}.`,
  );
}
const npmVersion = [...publicVersions][0];
if (requestedVersion && npmVersion && requestedVersion !== npmVersion) {
  failures.push(
    `Release version ${requestedVersion} does not match npm package version ${npmVersion}.`,
  );
}
if (requestedVersion && !/^0\.0\.1-alpha(?:\.[0-9]+)?$/.test(requestedVersion)) {
  failures.push(`Release version ${requestedVersion} is not the v0.0.1-alpha prerelease line.`);
}

for (const { manifest, dir } of publicPackages) {
  if (!manifest.name || !manifest.version) failures.push(`${dir} has no package name/version.`);
  if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
    warnings.push(`${manifest.name} has no explicit files allow-list.`);
  }
  for (const section of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
    for (const dependency of Object.keys(manifest[section] ?? {})) {
      const workspace = manifests.find(({ manifest: candidate }) => candidate.name === dependency);
      if (workspace?.manifest.private) {
        const message = `${manifest.name} depends on private workspace package ${dependency}.`;
        (strict ? failures : warnings).push(message);
      }
    }
  }
  try {
    const output = execFileSync('npm', ['pack', '--dry-run', '--json', '--workspace', dir], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const result = JSON.parse(output)[0];
    const files = new Set((result.files ?? []).map((file) => file.path));
    if (!files.has('package.json')) failures.push(`${manifest.name} dry-run omitted package.json.`);
    if (manifest.files?.includes('dist') && ![...files].some((file) => file.startsWith('dist/'))) {
      failures.push(`${manifest.name} dry-run contains no dist artifact.`);
    }
  } catch (error) {
    failures.push(`${manifest.name} npm pack --dry-run failed: ${error.message}`);
  }
}

const pythonPackages = [join(root, 'sdk/python'), join(root, 'sdk/python-module')];
const pythonVersions = new Set();
for (const dir of pythonPackages) {
  const text = readFileSync(join(dir, 'pyproject.toml'), 'utf8');
  const match =
    text.match(/^version\s*=\s*"([^"]+)"/m) ??
    text.match(/version\s*=\s*\{attr\s*=\s*"([^"]+)"\}/m);
  if (!match) {
    failures.push(`${dir}/pyproject.toml has no project version.`);
    continue;
  }
  let version = match[1];
  if (match[0].includes('attr')) {
    const module = match[1].match(/^([^.]+)\.__version__$/)?.[1];
    const source = module ? join(dir, 'src', module, '__init__.py') : '';
    const sourceMatch =
      source && existsSync(source)
        ? readFileSync(source, 'utf8').match(/__version__\s*=\s*"([^"]+)"/)
        : null;
    if (!sourceMatch) failures.push(`${dir}/pyproject.toml dynamic version source is unavailable.`);
    else version = sourceMatch[1];
  }
  pythonVersions.add(version);
}
if (pythonVersions.size > 1) {
  warnings.push(
    `Python package versions differ (expected for separate distributions): ${[...pythonVersions].join(', ')}.`,
  );
}
try {
  execFileSync('python3', ['-m', 'build', '--version'], { cwd: root, stdio: 'ignore' });
} catch {
  warnings.push(
    'python3 -m build is unavailable; the tagged workflow installs it before building Python artifacts.',
  );
}

for (const warning of warnings) console.warn(`release-check warning: ${warning}`);
if (failures.length) {
  for (const failure of failures) console.error(`release-check error: ${failure}`);
  process.exitCode = 1;
} else {
  console.log(
    `release-check passed (${publicPackages.length} npm packages inspected; no publication performed).`,
  );
}
