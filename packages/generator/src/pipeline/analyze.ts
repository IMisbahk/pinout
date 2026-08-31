import { ingestSource, hashSourceContent } from '../ingest/ingestSource.js';
import { createGeneratorProvider } from '../providers/registry.js';
import type { GeneratorConfig } from '../config.js';
import type { HardwareInterfaceIR } from '../types/ir.js';
import type { SourceDocument } from '../types/source.js';
import type { GeneratorProvider } from '../providers/types.js';

export interface AnalyzeOptions {
  sourcePath: string;
  config?: GeneratorConfig;
  provider?: GeneratorProvider;
  deviceClassHint?: string;
}

export async function analyzeHardwareSource(options: AnalyzeOptions): Promise<{
  sources: SourceDocument[];
  ir: HardwareInterfaceIR;
  sourceHashes: Record<string, string>;
}> {
  const sources = ingestSource(options.sourcePath);
  if (sources.length === 0) {
    throw new Error(`No supported source files found at '${options.sourcePath}'.`);
  }

  const sourceHashes: Record<string, string> = {};
  for (const source of sources) {
    sourceHashes[source.path] = hashSourceContent(source.content);
  }

  const provider =
    options.provider ??
    createGeneratorProvider(options.config ?? { provider: 'mock', model: 'pinout-heuristic-v1' });
  const model = provider.createModel(options.config?.model ?? 'pinout-heuristic-v1');

  const ir = await model.generateStructured<HardwareInterfaceIR>({
    name: 'hardware-interface-ir',
    instructions: buildInstructions(options.deviceClassHint),
    sources,
  });

  if (options.deviceClassHint && !ir.device.deviceClass) {
    ir.device.deviceClass = options.deviceClassHint;
  }

  return { sources, ir, sourceHashes };
}

function buildInstructions(deviceClassHint?: string): string {
  const hints = [
    'Extract device vendor, model, and semantic capabilities with evidence references.',
    'Map vendor methods to Pinout capability families where appropriate.',
    'Extract documented safety limits with confidence. Flag inferred limits for review.',
    'List uncertainties explicitly instead of guessing.',
  ];
  if (deviceClassHint) {
    hints.push(`Developer hint: device class may be ${deviceClassHint}.`);
  }
  return hints.join(' ');
}
