import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runModuleConformance } from '@pinout/core';
import { loadGeneratorConfig } from '../config.js';
import {
  emitCandidateModule,
  GENERATOR_VERSION,
  type EmitModuleOptions,
} from '../emit/moduleEmitter.js';
import { buildCandidateModule } from '../emit/buildModule.js';
import { analyzeHardwareSource, type AnalyzeOptions } from '../pipeline/analyze.js';
import { formatGenerationPlan, formatGenerationPlanJson } from '../pipeline/plan.js';
import { PINOUT_VERSION } from '@pinout/core';
import type { GenerationProvenance } from '../types/provenance.js';
import { createGeneratorProvider } from '../providers/registry.js';

export interface GenerateOptions {
  sourcePath: string;
  outputPath?: string;
  planOnly?: boolean;
  overwrite?: boolean;
  provider?: string;
  model?: string;
  deviceClass?: string;
  runConformance?: boolean;
}

export interface GenerateResult {
  plan: string;
  planJson: Record<string, unknown>;
  outputPath?: string;
  moduleId?: string;
  conformancePassed?: boolean;
  message: string;
}

export async function generateCandidateModule(options: GenerateOptions): Promise<GenerateResult> {
  const config = loadGeneratorConfig();
  if (options.provider) {
    config.provider = options.provider;
  }
  if (options.model) {
    config.model = options.model;
  }

  const provider = createGeneratorProvider(config);
  const analyzeOptions: AnalyzeOptions = {
    sourcePath: options.sourcePath,
    config,
    provider,
  };
  if (options.deviceClass) {
    analyzeOptions.deviceClassHint = options.deviceClass;
  }
  const { ir, sourceHashes } = await analyzeHardwareSource(analyzeOptions);

  const plan = formatGenerationPlan(ir);
  const planJson = formatGenerationPlanJson(ir);

  if (options.planOnly) {
    return {
      plan,
      planJson,
      message: 'Generation plan only — no files written.',
    };
  }

  const outputPath = options.outputPath ?? mkdtempSync(join(tmpdir(), 'pinout-generated-'));

  const provenance: GenerationProvenance = {
    pinoutVersion: PINOUT_VERSION,
    generatorVersion: GENERATOR_VERSION,
    provider: config.provider,
    model: config.model,
    timestamp: new Date().toISOString(),
    sourceHashes,
    status: 'GENERATED',
  };

  const emitOptions: EmitModuleOptions = { outputPath, ir, provenance };
  if (options.overwrite) {
    emitOptions.overwrite = true;
  }
  const emitted = emitCandidateModule(emitOptions);
  buildCandidateModule(emitted.outputPath);

  let conformancePassed: boolean | undefined;
  if (options.runConformance) {
    const conformance = await runModuleConformance(outputPath);
    conformancePassed = conformance.passed;
  }

  const result: GenerateResult = {
    plan,
    planJson,
    outputPath: emitted.outputPath,
    moduleId: emitted.moduleId,
    message: [
      'Generated candidate module.',
      'Status: UNVERIFIED',
      '',
      'Run:',
      `  pinout module test ${emitted.outputPath}`,
      '',
      'Review:',
      `  ${join(emitted.outputPath, 'GENERATION_REPORT.md')}`,
      '',
      'Physical execution is disabled until explicitly installed/configured.',
    ].join('\n'),
  };
  if (conformancePassed !== undefined) {
    result.conformancePassed = conformancePassed;
  }
  return result;
}

export function cleanupTempOutput(path: string, isTemp: boolean): void {
  if (isTemp) {
    rmSync(path, { recursive: true, force: true });
  }
}
