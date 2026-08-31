import type { CliIo } from './runCli.js';

export interface CliOutput {
  json: boolean;
  log: (value: unknown) => void;
  error: (message: string) => void;
}

export function createOutput(io: CliIo, json: boolean): CliOutput {
  return {
    json,
    log: (value) => {
      if (json) {
        io.log(JSON.stringify(value, null, 2));
        return;
      }
      if (typeof value === 'string') {
        io.log(value);
        return;
      }
      io.log(JSON.stringify(value, null, 2));
    },
    error: io.error,
  };
}

export function printLines(output: CliOutput, lines: string[]): void {
  if (output.json) {
    output.log({ lines });
    return;
  }
  for (const line of lines) {
    output.log(line);
  }
}
