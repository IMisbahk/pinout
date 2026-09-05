import type {
  DoctorCheckResult,
  DoctorDependencies,
  DoctorOptions,
  DoctorReport,
  DoctorSummary,
} from './types.js';
import type { CliOutput } from '../output.js';
import { checkEnvironmentVariables, checkNodeVersion, checkPinoutHome } from './environment.js';
import { checkDaemon } from './daemon.js';
import { checkDiscovery } from './discovery.js';
import { checkFirmware } from './firmware.js';
import { checkConfiguration } from './configuration.js';
import { checkSimulator } from './simulator.js';
import { renderDoctorReport } from './formatter.js';

export async function evaluateDoctor(
  options: DoctorOptions = {},
  deps: DoctorDependencies = {},
): Promise<DoctorReport> {
  const checks: DoctorCheckResult[] = [];

  // Stage 1: Environment
  checks.push(checkNodeVersion(deps));
  checks.push(checkPinoutHome(deps));
  checks.push(checkEnvironmentVariables(deps));

  // Stage 2: Daemon
  checks.push(await checkDaemon(options, deps));

  // Stage 3: Serial & Board Discovery
  const { checks: discoveryChecks, ports } = await checkDiscovery(options, deps);
  checks.push(...discoveryChecks);

  // Stage 4: Firmware Identity (non-actuating handshake)
  checks.push(await checkFirmware(options, deps, ports));

  // Stage 5: Configuration & Registry
  checks.push(...checkConfiguration(deps, ports));

  // Stage 6: Baseline Simulator Handshake
  checks.push(await checkSimulator(deps));

  // Calculate Summary
  const passed = checks.filter((check) => check.status === 'pass').length;
  const warned = checks.filter((check) => check.status === 'warn').length;
  const failed = checks.filter((check) => check.status === 'fail').length;
  const skipped = checks.filter((check) => check.status === 'skip').length;

  const summary: DoctorSummary = {
    total: checks.length,
    passed,
    warned,
    failed,
    skipped,
  };

  const status: 'pass' | 'warn' | 'fail' = failed > 0 ? 'fail' : warned > 0 ? 'warn' : 'pass';
  const ok = failed === 0;

  // Compile ordered next steps
  const nextSteps: string[] = [];
  for (const check of checks) {
    if (check.nextStep && check.status !== 'pass') {
      const stageTag = `[${check.stage.toUpperCase()}]`;
      const stepText = `${stageTag} ${check.nextStep}`;
      if (!nextSteps.includes(stepText)) {
        nextSteps.push(stepText);
      }
    }
  }

  return {
    ok,
    status,
    summary,
    checks,
    nextSteps,
  };
}

export async function runDoctor(
  output: CliOutput,
  options: DoctorOptions = {},
  deps: DoctorDependencies = {},
): Promise<number> {
  const report = await evaluateDoctor(options, deps);
  renderDoctorReport(report, output);
  return report.ok ? 0 : 1;
}
