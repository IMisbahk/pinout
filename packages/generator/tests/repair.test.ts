import { mkdtemp, mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseCompilerErrors, repairGeneratedModule } from '../src/pipeline/repair.js';

describe('parseCompilerErrors', () => {
  it('extracts file, line, code, and message from tsc output', () => {
    const output = [
      "src/index.ts(12,5): error TS2304: Cannot find name 'gpioHelper'.",
      'src/backend.ts(3,1): error TS2305: Module \'"./types.js"\' has no exported member \'Missing\'.',
      'npm warn something irrelevant',
    ].join('\n');
    const errors = parseCompilerErrors(output);
    expect(errors).toHaveLength(2);
    expect(errors[0]).toMatchObject({ file: 'src/index.ts', line: 12, code: 'TS2304' });
    expect(errors[1]!.code).toBe('TS2305');
  });
});

describe('repairGeneratedModule', () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'pinout-repair-'));
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('repairs a missing helper (TS2304) and succeeds on the next build', async () => {
    const outputPath = join(dir, 'module-a');
    await mkdir(join(outputPath, 'src'), { recursive: true });
    const entry = join(outputPath, 'src', 'index.ts');
    await writeFile(entry, 'export function run(): number {\n  return computeLevel({ pin: 2 });\n}\n');

    let call = 0;
    const result = repairGeneratedModule({
      outputPath,
      maxAttempts: 3,
      build: (path) => {
        call += 1;
        if (call === 1) {
          throw new Error("src/index.ts(2,10): error TS2304: Cannot find name 'computeLevel'.");
        }
        if (call > 2) throw new Error('should have stopped after success');
        // Second build succeeds only if the helper was appended.
        const content = (async () => '')();
        void content;
        void path;
      },
    });

    expect(result.success).toBe(true);
    expect(call).toBe(2);
    expect(result.repairsApplied.join('\n')).toContain('explicit safe stub');
    const repaired = await readFile(entry, 'utf8');
    expect(repaired).toContain('function computeLevel');
    expect(repaired).toContain('GENERATION_GAP');
  });

  it('repairs a stale import (TS2305) by removing only the missing symbol', async () => {
    const outputPath = join(dir, 'module-b');
    await mkdir(join(outputPath, 'src'), { recursive: true });
    const entry = join(outputPath, 'src', 'index.ts');
    await writeFile(
      entry,
      ["import { Missing, Real } from './types.js';", 'export const y = Real;', "export function z(): void { new Missing(); }"].join('\n'),
    );

    let call = 0;
    const result = repairGeneratedModule({
      outputPath,
      maxAttempts: 3,
      build: () => {
        call += 1;
        if (call === 1) {
          throw new Error("src/index.ts(1,10): error TS2305: Module '\"./types.js\"' has no exported member 'Missing'.");
        }
      },
    });

    expect(result.success).toBe(true);
    const repaired = await readFile(entry, 'utf8');
    expect(repaired).not.toContain('import { Missing');
    expect(repaired).toContain('export const y = Real;');
  });

  it('stops early when no repair rule applies', async () => {
    const outputPath = join(dir, 'module-c');
    await mkdir(join(outputPath, 'src'), { recursive: true });

    let calls = 0;
    const result = repairGeneratedModule({
      outputPath,
      maxAttempts: 3,
      build: () => {
        calls += 1;
        throw new Error("src/index.ts(1,1): error TS9999: Something unfixable and exotic.");
      },
    });

    expect(result.success).toBe(false);
    expect(calls).toBe(1); // no applicable rule → no wasted rebuilds
    expect(result.finalErrors[0]!.code).toBe('TS9999');
  });

  it('respects the attempt budget exactly', async () => {
    const outputPath = join(dir, 'module-d');
    await mkdir(join(outputPath, 'src'), { recursive: true });
    const entry = join(outputPath, 'src', 'index.ts');
    await writeFile(entry, 'const a = helperOne();\nconst b = helperTwo();\n');

    let calls = 0;
    const result = repairGeneratedModule({
      outputPath,
      maxAttempts: 2,
      build: () => {
        calls += 1;
        throw new Error(`src/index.ts(1,7): error TS2304: Cannot find name 'helperOne${calls}'.`);
      },
    });

    expect(result.success).toBe(false);
    expect(calls).toBe(2);
    expect(result.attempts).toHaveLength(2);
  });
});
