import { ByteQueue } from './byteQueue.js';
import type { Transport } from '../types.js';

export interface LoopbackTransportOptions {
  /** Response lines emitted when open() is called (newline optional). */
  onOpen?: () => string[];
  /** Called for each host write; return response line(s) to inject. */
  onWrite?: (data: string) => string | string[] | undefined;
}

export function loopbackTransport(options: LoopbackTransportOptions = {}): LoopbackTransport {
  return new LoopbackTransport(options);
}

export class LoopbackTransport implements Transport {
  readonly kind = 'loopback';
  private readonly inbound = new ByteQueue();
  private readonly decoder = new TextDecoder();
  private opened = false;

  constructor(private readonly options: LoopbackTransportOptions) {}

  get readable(): AsyncIterable<Uint8Array> {
    return this.inbound;
  }

  /** Push a protocol line into the readable stream (for manual test control). */
  inject(line: string): void {
    const normalized = line.endsWith('\n') ? line : `${line}\n`;
    this.inbound.push(new TextEncoder().encode(normalized));
  }

  async open(): Promise<void> {
    if (this.opened) {
      return;
    }
    this.opened = true;
    for (const line of this.options.onOpen?.() ?? []) {
      this.inject(line);
    }
  }

  async close(): Promise<void> {
    this.inbound.close();
  }

  async write(data: Uint8Array): Promise<void> {
    const text = this.decoder.decode(data);
    const responses = this.options.onWrite?.(text);
    if (!responses) {
      return;
    }
    const lines = Array.isArray(responses) ? responses : [responses];
    for (const line of lines) {
      this.inject(line);
    }
  }
}
