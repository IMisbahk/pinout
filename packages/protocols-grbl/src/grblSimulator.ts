/**
 * A deterministic in-process GRBL v1.x simulator (Transport).
 *
 * Executes the subset the adapter uses: status polls, $H homing with animated
 * position movement, G0/G1 moves that update WPos, `!` feed hold, `$G` parser
 * state, and error responses for malformed commands. Deterministic: motion
 * completes immediately per command unless an explicit delay is configured.
 */
import type { Transport } from '@pinout/core';

export interface GrblSimulatorOptions {
  version?: string;
  /** Simulated execution delay per motion command, ms (default 0 for tests). */
  motionDelayMs?: number;
  /** Soft-limit maximums in mm (x, y, z). Exceeding them returns error:33. */
  travel?: { x: number; y: number; z: number };
}

interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export class GrblSimulatorTransport implements Transport {
  readonly kind = 'grbl-simulator';
  private readonly listeners = new Set<(chunk: Uint8Array) => void>();
  private readonly options: Required<Pick<GrblSimulatorOptions, 'version' | 'motionDelayMs'>> &
    GrblSimulatorOptions;
  private wpos: Vec3 = { x: 0, y: 0, z: 0 };
  private mposOffset: Vec3 = { x: 10, y: 5, z: 0 };
  private homed = false;
  private state = 'Idle';
  private feedRate: number | undefined;
  private startupEmitted = false;
  private inputBuffer = '';
  private closed = false;

  constructor(options: GrblSimulatorOptions = {}) {
    this.options = {
      version: options.version ?? '1.1h',
      motionDelayMs: options.motionDelayMs ?? 0,
      ...(options.travel !== undefined ? { travel: options.travel } : {}),
    };
  }

  get readable(): AsyncIterable<Uint8Array> {
    const listeners = this.listeners;
    const isClosed = () => this.closed;
    return {
      async *[Symbol.asyncIterator]() {
        const queue: Uint8Array[] = [];
        let notify: (() => void) | undefined;
        const listener = (chunk: Uint8Array): void => {
          queue.push(chunk);
          notify?.();
        };
        listeners.add(listener);
        try {
          while (!isClosed()) {
            if (queue.length === 0) {
              await new Promise<void>((resolve) => {
                notify = resolve;
              });
              continue;
            }
            yield queue.shift()!;
          }
        } finally {
          listeners.delete(listener);
        }
      },
    };
  }

  async open(): Promise<void> {
    this.closed = false;
    if (!this.startupEmitted) {
      this.startupEmitted = true;
      this.respond(`Grbl ${this.options.version} ['$' for help]\r\n`);
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    this.emit(new Uint8Array());
  }

  async write(data: Uint8Array): Promise<void> {
    const text = new TextDecoder().decode(data);
    // Out-of-band single characters (real GRBL treats these immediately) and
    // they are CONSUMED so they never pollute the command line buffer.
    let lineText = '';
    for (const char of text) {
      if (char === '?') {
        this.respond(this.statusLine());
      } else if (char === '!') {
        this.state = 'Hold:0';
      } else if (char === '\x18') {
        this.state = 'Alarm';
        this.respond("Grbl 1.1h ['$' for help]\r\n");
      } else {
        lineText += char;
      }
    }
    // Commands are line-buffered across writes, like a real serial link.
    this.inputBuffer += lineText;
    for (;;) {
      const newline = this.inputBuffer.indexOf('\n');
      if (newline === -1) break;
      const rawLine = this.inputBuffer.slice(0, newline);
      this.inputBuffer = this.inputBuffer.slice(newline + 1);
      const line = rawLine.replace(/\r/g, '').trim();
      if (line.length === 0) continue;
      if (line === '?') continue;
      await this.handleCommand(line);
    }
  }

  private async handleCommand(line: string): Promise<void> {
    if (line === '$H') {
      this.state = 'Home';
      await this.delay(5);
      this.homed = true;
      this.wpos = { x: 0, y: 0, z: 0 };
      this.state = 'Idle';
      this.respond('ok\r\n');
      return;
    }
    if (line === '$G') {
      const feed = this.feedRate !== undefined ? ` F${this.feedRate}` : '';
      this.respond(`[GC:G0 G54 G17 G21 G90 G94 M5 M9 T0${feed}]\r\n`);
      this.respond('ok\r\n');
      return;
    }
    if (line === '$#' || line.startsWith('$')) {
      this.respond('ok\r\n');
      return;
    }
    const move = /^(?:G21 G90 G94 )?(G0|G1)\s+(.*)$/.exec(line);
    if (move) {
      const axes = move[2]!.split(/\s+/);
      const target: Vec3 = { ...this.wpos };
      for (const axis of axes) {
        const letter = axis[0]!.toLowerCase();
        const value = Number.parseFloat(axis.slice(1));
        if ((letter === 'x' || letter === 'y' || letter === 'z') && Number.isFinite(value)) {
          target[letter] = value;
        }
      }
      if (this.options.travel) {
        const travel = this.options.travel;
        const inside =
          target.x >= 0 &&
          target.x <= travel.x &&
          target.y >= 0 &&
          target.y <= travel.y &&
          target.z >= 0 &&
          target.z <= travel.z;
        if (!inside || !this.homed) {
          this.respond(this.homed ? 'error:33\r\n' : 'error:9\r\n');
          return;
        }
      }
      if (move[1] === 'G1') {
        const feed = /F(\d+(?:\.\d+)?)/.exec(move[2]!);
        this.feedRate = feed ? Number.parseFloat(feed[1]!) : undefined;
      }
      this.state = 'Run';
      await this.delay(this.options.motionDelayMs);
      this.wpos = target;
      this.state = 'Idle';
      this.respond('ok\r\n');
      return;
    }
    this.respond('error:20\r\n');
  }

  private statusLine(): string {
    const w = this.wpos;
    const m = {
      x: w.x + this.mposOffset.x,
      y: w.y + this.mposOffset.y,
      z: w.z + this.mposOffset.z,
    };
    const format = (v: Vec3): string => `${v.x.toFixed(3)},${v.y.toFixed(3)},${v.z.toFixed(3)}`;
    return `<${this.state}|WPos:${format(w)}|MPos:${format(m)}|FS:0,0>\r\n`;
  }

  private async delay(ms: number): Promise<void> {
    if (ms > 0) await new Promise((resolve) => setTimeout(resolve, ms));
  }

  private respond(text: string): void {
    this.emit(new TextEncoder().encode(text));
  }

  private emit(chunk: Uint8Array): void {
    for (const listener of this.listeners) {
      listener(chunk);
    }
  }
}
