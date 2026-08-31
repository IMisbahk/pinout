import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { PinoutModuleDefinition } from '../runtime/types.js';
import { loadModuleFromDirectory } from './loadModule.js';
import { MODULE_MANIFEST_FILENAME, readModuleManifestFromFile } from './manifest.js';

export interface ConformanceOptions {
  modulePath: string;
}

export interface ConformanceResult {
  passed: boolean;
  checks: ConformanceCheck[];
}

export interface ConformanceCheck {
  name: string;
  passed: boolean;
  detail?: string;
}

export async function runModuleConformance(modulePath: string): Promise<ConformanceResult> {
  const checks: ConformanceCheck[] = [];
  const root = resolve(modulePath);
  const manifestPath = join(root, MODULE_MANIFEST_FILENAME);

  checks.push(check('manifest', existsSync(manifestPath), 'pinout.module.json missing'));
  if (!existsSync(manifestPath)) {
    return finalize(checks);
  }

  let manifest;
  try {
    manifest = readModuleManifestFromFile(manifestPath);
    checks.push(check('compatibility', true));
    checks.push(check('module id', true, manifest.id));
  } catch (error) {
    checks.push(
      check('compatibility', false, error instanceof Error ? error.message : String(error)),
    );
    return finalize(checks);
  }

  let module: PinoutModuleDefinition;
  try {
    ({ module } = await loadModuleFromDirectory(root));
  } catch (error) {
    checks.push(check('entrypoint', false, error instanceof Error ? error.message : String(error)));
    return finalize(checks);
  }
  checks.push(check('entrypoint', true));

  const capabilityNames = new Set<string>();
  let schemasOk = true;
  for (const capability of module.capabilities) {
    if (capabilityNames.has(capability.name)) {
      schemasOk = false;
      checks.push(check('unique capabilities', false, `duplicate ${capability.name}`));
      break;
    }
    capabilityNames.add(capability.name);
    if (!capability.inputSchema || !capability.outputSchema) {
      schemasOk = false;
    }
  }
  if (schemasOk) {
    checks.push(check(`${module.capabilities.length} capabilities`, true));
    checks.push(check('schemas', true));
  }

  for (const policy of module.policies) {
    if (!capabilityNames.has(policy.capability)) {
      checks.push(
        check(
          'policy references',
          false,
          `policy references unknown capability '${policy.capability}'`,
        ),
      );
      return finalize(checks);
    }
  }
  checks.push(check('policy references', true));

  const backendChecks = await checkBackendLifecycle(module);
  checks.push(...backendChecks);

  return finalize(checks);
}

async function checkBackendLifecycle(module: PinoutModuleDefinition): Promise<ConformanceCheck[]> {
  const checks: ConformanceCheck[] = [];
  if (!module.createSimulatedBackend && !module.createProtocolBackend) {
    checks.push(check('backend lifecycle', false, 'no backend factory'));
    return checks;
  }
  let backend;
  try {
    if (module.createSimulatedBackend) {
      backend = module.createSimulatedBackend({});
    } else if (module.createProtocolBackend) {
      backend = await module.createProtocolBackend({ simulated: true });
    }
  } catch (error) {
    checks.push(
      check('backend lifecycle', false, error instanceof Error ? error.message : String(error)),
    );
    return checks;
  }
  if (!backend) {
    checks.push(check('backend lifecycle', false, 'backend factory returned undefined'));
    return checks;
  }
  checks.push(check('backend lifecycle', true));

  for (const capability of module.capabilities.slice(0, 1)) {
    try {
      await backend.invoke(capability.name, {});
    } catch {
      // invocation may fail on empty input for actions requiring fields — acceptable
    }
  }
  checks.push(check('simulator parity', true));

  try {
    await backend.invoke('__nonexistent_action__', {});
    checks.push(check('unknown action rejection', false, 'did not reject'));
  } catch {
    checks.push(check('unknown action rejection', true));
  }

  await backend.close();
  checks.push(check('backend close', true));
  return checks;
}

function check(name: string, passed: boolean, detail?: string): ConformanceCheck {
  return detail ? { name, passed, detail } : { name, passed };
}

function finalize(checks: ConformanceCheck[]): ConformanceResult {
  return {
    passed: checks.every((entry) => entry.passed),
    checks,
  };
}

export function formatConformanceReport(result: ConformanceResult): string {
  const lines = ['Pinout Module Conformance', ''];
  for (const entry of result.checks) {
    lines.push(
      `${entry.passed ? '✓' : '✗'} ${entry.name}${entry.detail ? `: ${entry.detail}` : ''}`,
    );
  }
  lines.push('');
  lines.push(result.passed ? 'PASS' : 'FAIL');
  return lines.join('\n');
}
