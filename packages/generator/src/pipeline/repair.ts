/**
 * Bounded compile-repair loop for generated modules.
 *
 * Generated candidates may fail `tsc` on the first attempt. The repair loop:
 *
 *   generate → build → parse compiler errors → targeted repair → rebuild
 *
 * Hard rules (never violated by repair):
 * - Safety evidence requirements are NOT weakened: provenance classification
 *   and hard-eligibility are frozen before repair begins.
 * - Bounded attempts (default 3). After the budget, the candidate is reported
 *   as failed with the compiler errors intact — never shipped half-fixed.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildCandidateModule } from '../emit/buildModule.js';

export interface CompilerError {
  file: string;
  line: number;
  code: string;
  message: string;
}

export interface RepairAttempt {
  attempt: number;
  success: boolean;
  errors: CompilerError[];
  repairsApplied: string[];
}

export interface RepairResult {
  success: boolean;
  attempts: RepairAttempt[];
  finalErrors: CompilerError[];
  repairsApplied: string[];
}

export interface RepairOptions {
  outputPath: string;
  maxAttempts?: number;
  /** Entry file whose errors drive the repair (default src/index.ts). */
  entryFile?: string;
  /**
   * Build function injectable for tests. Defaults to the real tsc build of
   * the candidate. Must throw with compiler output on failure.
   */
  build?: (outputPath: string) => void;
}

export function parseCompilerErrors(tscOutput: string): CompilerError[] {
  const errors: CompilerError[] = [];
  const errorRegex = /([^\s(]+\.ts)\((\d+),(\d+)\):\s*error\s+(TS\d+):\s*(.+)/g;
  let match: RegExpExecArray | null;
  while ((match = errorRegex.exec(tscOutput)) !== null) {
    errors.push({
      file: match[1]!,
      line: Number.parseInt(match[2]!, 10),
      code: match[4]!,
      message: match[5]!,
    });
  }
  return errors;
}

interface RepairRule {
  applies(error: CompilerError): boolean;
  describe(): string;
  apply(filePath: string, error: CompilerError): boolean;
}

/**
 * Deterministic repair rules. Each rule is narrow and safe: they only fix
 * mechanical emit bugs, never alter capability metadata, safety constraints,
 * or evidence.
 */
const REPAIR_RULES: RepairRule[] = [
  {
    // TS2724: exported symbol missing from module — usually a stale import.
    applies: (error) => error.code === 'TS2724' || error.code === 'TS2305',
    describe: () => 'remove import of a symbol the emitter did not generate',
    apply: (filePath, error) => {
      const symbolMatch = /'([^']+)'/.exec(error.message);
      if (!symbolMatch) return false;
      const symbol = symbolMatch[1]!;
      if (!existsSync(filePath)) return false;
      const content = readFileSync(filePath, 'utf8');
      const lines = content.split('\n');
      const filtered = lines.filter((line) => {
        const isImport = /^\s*import\b/.test(line);
        const mentionsSymbol = new RegExp(`\\b${symbol}\\b`).test(line);
        return !(isImport && mentionsSymbol);
      });
      if (filtered.length === lines.length) return false;
      writeFileSync(filePath, filtered.join('\n'));
      return true;
    },
  },
  {
    // TS2352/TS2339 in generated backends: emit bug where a helper is referenced
    // but not defined — inject a typed stub that throws the safe explicit error.
    applies: (error) => error.code === 'TS2304',
    describe: () => 'define missing helper as an explicit safe stub',
    apply: (filePath, error) => {
      const symbolMatch = /Cannot find name '([^']+)'/.exec(error.message);
      if (!symbolMatch) return false;
      const symbol = symbolMatch[1]!;
      if (!existsSync(filePath)) return false;
      const content = readFileSync(filePath, 'utf8');
      if (new RegExp(`\\b${symbol}\\b\\s*[=(]`).test(content)) return false;
      const stub = `\n\nfunction ${symbol}(payload: Record<string, unknown>): never {\n  throw new Error('GENERATION_GAP: helper ${symbol} was not fully generated; refusing to fabricate hardware behavior.');\n}\n`;
      writeFileSync(filePath, content + stub);
      return true;
    },
  },
];

export function repairGeneratedModule(options: RepairOptions): RepairResult {
  const maxAttempts = options.maxAttempts ?? 3;
  const entryPath = join(options.outputPath, options.entryFile ?? 'src/index.ts');
  const attempts: RepairAttempt[] = [];
  const repairsApplied: string[] = [];

  const build = options.build ?? buildCandidateModule;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let buildOutput = '';
    try {
      build(options.outputPath);
      attempts.push({ attempt, success: true, errors: [], repairsApplied: [] });
      return { success: true, attempts, finalErrors: [], repairsApplied };
    } catch (error) {
      buildOutput = error instanceof Error ? error.message : String(error);
    }

    const errors = parseCompilerErrors(buildOutput);
    if (errors.length === 0) {
      // Build failed for a non-TypeScript reason; repair cannot help.
      attempts.push({ attempt, success: false, errors: [], repairsApplied: [] });
      break;
    }

    const attemptRepairs: string[] = [];
    for (const error of errors) {
      for (const rule of REPAIR_RULES) {
        if (!rule.applies(error)) continue;
        const target = error.file.startsWith('/')
          ? error.file
          : join(options.outputPath, error.file);
        if (rule.apply(target, error)) {
          const description = rule.describe();
          attemptRepairs.push(`[${error.code}] ${description}`);
          break;
        }
      }
    }

    attempts.push({ attempt, success: false, errors, repairsApplied: attemptRepairs });
    repairsApplied.push(...attemptRepairs);

    if (attemptRepairs.length === 0) {
      // No rule could help; stop before wasting the remaining budget.
      break;
    }
  }

  return {
    success: false,
    attempts,
    finalErrors: attempts[attempts.length - 1]?.errors ?? [],
    repairsApplied,
  };
}
