import { readFile } from 'node:fs/promises';
export interface ScriptInvoker {
  invoke(action: string, payload: Record<string, unknown>): Promise<Record<string, unknown>>;
}

export interface ScriptStep {
  action: string;
  payload?: Record<string, unknown>;
}

export interface ScriptResult {
  action: string;
  result: Record<string, unknown>;
}

export async function readScriptSteps(source: string): Promise<ScriptStep[]> {
  const trimmed = source.trim();
  if (!trimmed) {
    throw new Error('Script is empty.');
  }

  if (trimmed.startsWith('[')) {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!Array.isArray(parsed)) {
      throw new Error('Script JSON must be an array of action steps.');
    }
    return parsed.map(parseScriptStep);
  }

  return trimmed
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
    .map((line) => parseScriptStep(JSON.parse(line)));
}

export async function readScriptFile(path: string): Promise<ScriptStep[]> {
  return readScriptSteps(await readFile(path, 'utf8'));
}

export async function runScript(
  device: ScriptInvoker,
  steps: ScriptStep[],
): Promise<ScriptResult[]> {
  const results: ScriptResult[] = [];
  for (const step of steps) {
    const result = await device.invoke(step.action, step.payload ?? {});
    results.push({ action: step.action, result });
  }
  return results;
}

function parseScriptStep(value: unknown): ScriptStep {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Each script step must be a JSON object with an action field.');
  }
  const record = value as Record<string, unknown>;
  if (typeof record.action !== 'string' || record.action.length === 0) {
    throw new Error('Each script step must include a non-empty action string.');
  }
  if (record.payload === undefined) {
    return { action: record.action };
  }
  if (
    typeof record.payload !== 'object' ||
    record.payload === null ||
    Array.isArray(record.payload)
  ) {
    throw new Error(`Step '${record.action}' payload must be a JSON object.`);
  }
  return { action: record.action, payload: record.payload as Record<string, unknown> };
}
