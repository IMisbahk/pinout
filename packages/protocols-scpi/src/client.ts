import type { Transport } from '@pinout/core';
import { parseScpiCommand, parseScpiErrorQueueLine, parseScpiNumber } from './parser.js';
import type { ScpiErrorQueueEntry } from './parser.js';
import { ScpiClosedError, ScpiResponseError, ScpiTimeoutError, ScpiUsageError } from './errors.js';

export interface ScpiClientOptions {
  /** Default per-request timeout in milliseconds (default 5000). */
  timeoutMs?: number;
  /** Terminator appended to every outgoing command (default '\n'). */
  terminator?: string;
  /** Called for inbound lines that no pending request is waiting for. */
  onUnsolicited?: (line: string) => void;
}

export interface ScpiRequestOptions {
  /** Per-request timeout in milliseconds; overrides the client default. */
  timeoutMs?: number;
}

/** The four IEEE 488.2 identification fields returned by `*IDN?`. */
export interface ScpiIdentity {
  manufacturer: string;
  model: string;
  serialNumber: string;
  firmwareVersion: string;
}

interface PendingRequest {
  resolve: (line: string) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout> | undefined;
}

function unrefTimer(timer: ReturnType<typeof setTimeout>): void {
  if (typeof timer === 'object' && timer !== null && 'unref' in timer) {
    timer.unref();
  }
}

/**
 * SCPI client over any core {@link Transport}.
 *
 * Guarantees:
 * - Requests are strictly sequential — commands and queries are queued, so a
 *   second request cannot interleave on the transport before the first one is
 *   written and (for queries) its response consumed.
 * - Every query awaits exactly one response line with a timeout.
 * - Lines that arrive with no pending request go to `onUnsolicited`.
 *
 * The client owns the line framing: responses are terminated by `\n`
 * (optional preceding `\r`), independent of the outgoing terminator.
 */
export class ScpiClient {
  private readonly transport: Transport;
  private readonly defaultTimeoutMs: number;
  private readonly terminator: string;
  private readonly onUnsolicited: ((line: string) => void) | undefined;
  private readonly pending: PendingRequest[] = [];
  private tail: Promise<unknown> = Promise.resolve();
  private opened = false;
  private closed = false;

  constructor(transport: Transport, options?: ScpiClientOptions) {
    this.transport = transport;
    this.defaultTimeoutMs = options?.timeoutMs ?? 5000;
    this.terminator = options?.terminator ?? '\n';
    this.onUnsolicited = options?.onUnsolicited;
  }

  /** True between a successful open() and transport close. */
  get isOpen(): boolean {
    return this.opened && !this.closed;
  }

  /** Open the transport and start the response reader loop. */
  async open(): Promise<void> {
    if (this.opened) {
      return;
    }
    await this.transport.open();
    this.opened = true;
    this.closed = false;
    void this.readLoop();
  }

  /**
   * Close the transport. Any request still waiting for a response is rejected
   * with {@link ScpiClosedError}. Idempotent.
   */
  async close(): Promise<void> {
    if (!this.opened) {
      return;
    }
    this.closed = true;
    await this.transport.close();
    this.failPending(new ScpiClosedError('The SCPI transport was closed.'));
  }

  /**
   * Send a non-query command. Refuses queries (they always produce a response;
   * sending them here would corrupt the response stream) — use {@link query}.
   */
  async command(command: string): Promise<void> {
    return this.enqueue(async () => {
      if (!this.isOpen) {
        throw new ScpiClosedError();
      }
      const parsed = parseScpiCommand(command);
      if (parsed.query) {
        throw new ScpiUsageError(
          `'${command.trim()}' is a query; use query() to read its response.`,
        );
      }
      await this.write(command);
    });
  }

  /**
   * Send a query and await its single response line. Refuses non-queries —
   * they never produce a response, so waiting would only end in a timeout.
   */
  async query(command: string, options?: ScpiRequestOptions): Promise<string> {
    return this.enqueue(async () => {
      if (!this.isOpen) {
        throw new ScpiClosedError();
      }
      const parsed = parseScpiCommand(command);
      if (!parsed.query) {
        throw new ScpiUsageError(`'${command.trim()}' is not a query; use command().`);
      }
      return this.sendAndAwait(command, options?.timeoutMs ?? this.defaultTimeoutMs);
    });
  }

  /**
   * Send any command; resolves with the response line for queries and with
   * `undefined` for non-queries. This is the escape hatch used by
   * `ScpiInstrument.raw()`.
   */
  async execute(command: string, options?: ScpiRequestOptions): Promise<string | undefined> {
    const parsed = parseScpiCommand(command);
    if (parsed.query) {
      return this.query(command, options);
    }
    await this.command(command);
    return undefined;
  }

  /** Query and parse a numeric response. */
  async queryNumber(command: string, options?: ScpiRequestOptions): Promise<number> {
    const response = await this.query(command, options);
    return parseScpiNumber(response);
  }

  /** Query and parse a boolean response (`1`/`ON`/`0`/`OFF`). */
  async queryBoolean(command: string, options?: ScpiRequestOptions): Promise<boolean> {
    const response = (await this.query(command, options)).trim().toUpperCase();
    if (response === '1' || response === 'ON') {
      return true;
    }
    if (response === '0' || response === 'OFF') {
      return false;
    }
    throw new ScpiResponseError(`'${response}' is not a SCPI boolean response.`);
  }

  /** IEEE 488.2 identification: `*IDN?` parsed into its four fields. */
  async identify(options?: ScpiRequestOptions): Promise<ScpiIdentity> {
    const response = await this.query('*IDN?', options);
    const fields = response.split(',').map((field) => field.trim());
    if (fields.length < 4) {
      throw new ScpiResponseError(
        `*IDN? must return four comma-separated fields; received '${response.trim()}'.`,
      );
    }
    return {
      manufacturer: fields[0] ?? '',
      model: fields[1] ?? '',
      serialNumber: fields[2] ?? '',
      firmwareVersion: fields[3] ?? '',
    };
  }

  /** IEEE 488.2 `*RST` — restore instrument defaults. */
  async reset(): Promise<void> {
    await this.command('*RST');
  }

  /** IEEE 488.2 `*CLS` — clear status and error queues. */
  async clearStatus(): Promise<void> {
    await this.command('*CLS');
  }

  /** IEEE 488.2 `*OPC?` — true once all pending operations complete. */
  async operationComplete(options?: ScpiRequestOptions): Promise<boolean> {
    return this.queryBoolean('*OPC?', options);
  }

  /**
   * Read one `SYST:ERR?` entry. Returns `null` for the terminating
   * code-0 entry ("no error"), or the parsed `{ code, message }`.
   */
  async readError(options?: ScpiRequestOptions): Promise<ScpiErrorQueueEntry | null> {
    const response = await this.query(':SYST:ERR?', options);
    const entry = parseScpiErrorQueueLine(response);
    if (entry === undefined) {
      throw new ScpiResponseError(
        `Cannot parse SYST:ERR? response '${response.trim()}' as 'code,"message"'.`,
      );
    }
    if (entry.code === 0) {
      return null;
    }
    return entry;
  }

  /** Drain the error queue with `SYST:ERR?` until the code-0 entry. */
  async drainErrors(
    options?: ScpiRequestOptions & { maxEntries?: number },
  ): Promise<ScpiErrorQueueEntry[]> {
    const maxEntries = options?.maxEntries ?? 100;
    const errors: ScpiErrorQueueEntry[] = [];
    while (errors.length < maxEntries) {
      const entry = await this.readError(options);
      if (entry === null) {
        return errors;
      }
      errors.push(entry);
    }
    throw new ScpiResponseError(
      `Error queue did not drain within ${String(maxEntries)} SYST:ERR? reads.`,
    );
  }

  /** Serialize every request behind the previous one. */
  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.tail.then(task);
    this.tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private write(command: string): Promise<void> {
    const payload = command.endsWith(this.terminator) ? command : command + this.terminator;
    return this.transport.write(new TextEncoder().encode(payload));
  }

  /** Register the waiter BEFORE writing so the response can never be missed. */
  private sendAndAwait(command: string, timeoutMs: number): Promise<string> {
    const pending: PendingRequest = {
      resolve: () => undefined,
      reject: () => undefined,
      timer: undefined,
    };
    const promise = new Promise<string>((resolve, reject) => {
      pending.resolve = resolve;
      pending.reject = reject;
    });
    const timer = setTimeout(() => {
      const index = this.pending.indexOf(pending);
      if (index >= 0) {
        this.pending.splice(index, 1);
      }
      pending.reject(
        new ScpiTimeoutError(`No response within ${String(timeoutMs)} ms to '${command.trim()}'.`),
      );
    }, timeoutMs);
    unrefTimer(timer);
    pending.timer = timer;
    this.pending.push(pending);

    return this.write(command).then(
      () => promise,
      (error: unknown) => {
        const index = this.pending.indexOf(pending);
        if (index >= 0) {
          this.pending.splice(index, 1);
        }
        clearTimeout(timer);
        throw error;
      },
    );
  }

  private dispatchLine(line: string): void {
    const pending = this.pending.shift();
    if (pending) {
      if (pending.timer !== undefined) {
        clearTimeout(pending.timer);
      }
      pending.resolve(line);
      return;
    }
    if (this.onUnsolicited !== undefined) {
      this.onUnsolicited(line);
    }
  }

  private failPending(error: ScpiClosedError): void {
    while (this.pending.length > 0) {
      const pending = this.pending.shift();
      if (!pending) {
        break;
      }
      if (pending.timer !== undefined) {
        clearTimeout(pending.timer);
      }
      pending.reject(error);
    }
  }

  private async readLoop(): Promise<void> {
    try {
      const decoder = new TextDecoder();
      let buffer = '';
      for await (const chunk of this.transport.readable) {
        buffer += decoder.decode(chunk, { stream: true });
        for (;;) {
          const newlineAt = buffer.indexOf('\n');
          if (newlineAt < 0) {
            break;
          }
          const line = buffer.slice(0, newlineAt).replace(/\r$/, '');
          buffer = buffer.slice(newlineAt + 1);
          if (line.length > 0) {
            this.dispatchLine(line);
          }
        }
      }
    } catch {
      // The transport failed or was closed underneath us; pending requests
      // are failed below either way.
    }
    if (!this.closed) {
      this.closed = true;
      try {
        await this.transport.close();
      } catch {
        // The transport is already gone.
      }
    }
    this.failPending(new ScpiClosedError('The SCPI transport closed before a response arrived.'));
  }
}
