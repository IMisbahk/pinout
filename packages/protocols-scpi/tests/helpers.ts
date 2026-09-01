import { ScpiClient } from '../src/client.js';
import { loopbackTransport } from '@pinout/core';
import type { LoopbackTransport } from '@pinout/core';

export interface ScriptedScpi {
  client: ScpiClient;
  transport: LoopbackTransport;
  /** Commands as seen by the "instrument", terminator stripped. */
  requests: string[];
  /** Raw payload bytes written to the transport, including terminators. */
  rawWrites: string[];
  open(): Promise<void>;
}

/**
 * Build an open ScpiClient over a loopback transport that answers each written
 * command line with a scripted response (string or several lines).
 */
export function createScriptedScpi(
  responses: Record<string, string | string[]>,
  options?: { onUnsolicited?: (line: string) => void; terminator?: string },
): ScriptedScpi {
  const requests: string[] = [];
  const rawWrites: string[] = [];
  // Each command maps to a FIFO of scripted responses; every matching write
  // consumes the next response in order, enabling multi-step scripts such as
  // error-queue drains. Missing or exhausted scripts answer nothing.
  const queues = new Map<string, string[]>();
  for (const [command, response] of Object.entries(responses)) {
    queues.set(command, Array.isArray(response) ? [...response] : [response]);
  }
  const transport = loopbackTransport({
    onWrite: (data) => {
      rawWrites.push(data);
      const line = data.replace(/\r?\n$/, '');
      requests.push(line);
      const queue = queues.get(line);
      if (queue === undefined || queue.length === 0) {
        return undefined;
      }
      return queue.shift();
    },
  });
  const client = new ScpiClient(transport, {
    ...(options?.onUnsolicited !== undefined ? { onUnsolicited: options.onUnsolicited } : {}),
    ...(options?.terminator !== undefined ? { terminator: options.terminator } : {}),
  });
  return {
    client,
    transport,
    requests,
    rawWrites,
    open: () => client.open(),
  };
}
