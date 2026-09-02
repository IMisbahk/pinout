/**
 * GRBL adapter (spec v1).
 *
 * Implements the GRBL v1.x serial protocol over any Pinout Transport:
 * status polls (`?`), homing (`$H`), straight-line motion (`G0`/`G1` with
 * millimeter coordinates and feed rate), feed hold (`!`), and soft reset
 * (0x18). All motion capabilities are PHYSICAL_SIDE_EFFECT and stated in
 * millimeters — no unit guessing.
 *
 * THIS DRIVES REAL MACHINERY. This adapter does not make operating a CNC
 * safe: independent hardware e-stops, limit switches, and supervision are
 * always required. Support status: IMPLEMENTED (simulator-tested only),
 * never HARDWARE_VERIFIED.
 */
import type { Transport } from '@pinout/core';
import { GrblStatusError, GrblError } from './errors.js';

const DEFAULT_TIMEOUT_MS = 5000;

export interface GrblMachineStatus {
  state: string;
  /** Machine position in mm, when reported. */
  mpos?: { x: number; y: number; z: number };
  /** Work position in mm, when reported. */
  wpos?: { x: number; y: number; z: number };
  /** Feed and spindle overrides when present, e.g. `F:100,S:1000`. */
  raw: string;
}

export class GrblClient {
  private readonly transport: Transport;
  private readonly lineBuffer: number[] = [];
  private readonly waiters: Array<(line: string) => void> = [];
  private consuming = false;
  private closed = false;

  constructor(transport: Transport) {
    this.transport = transport;
  }

  async start(): Promise<void> {
    await this.transport.open();
    void this.consume();
    // Wake the controller (GRBL resets its line buffer on connect).
    await this.transport.write(new TextEncoder().encode('\r\n\r\n'));
    await this.waitForLine((line) => line.includes('Grbl'), 3000).catch(() => undefined);
  }

  async close(): Promise<void> {
    this.closed = true;
    await this.transport.close();
  }

  /** Poll machine status. `?` never actuates anything. */
  async status(timeoutMs = DEFAULT_TIMEOUT_MS): Promise<GrblMachineStatus> {
    await this.transport.write(new TextEncoder().encode('?'));
    const line = await this.waitForLine((candidate) => candidate.startsWith('<') && candidate.endsWith('>'), timeoutMs);
    return parseStatusLine(line);
  }

  /** Run the homing cycle ($H). PHYSICAL MOTION. */
  async home(timeoutMs = 30_000): Promise<void> {
    await this.sendExpectOk('$H', timeoutMs);
  }

  /**
   * Rapid linear move (G0) to a position in millimeters.
   * PHYSICAL MOTION — the caller owns workspace and axis-limit policies.
   */
  async rapidMove(position: { x?: number; y?: number; z?: number }, timeoutMs = 30_000): Promise<void> {
    await this.sendLine(buildMove('G0', position), timeoutMs);
  }

  /**
   * Linear move at a feed rate (G1) in millimeters with mm/min feed.
   * PHYSICAL MOTION.
   */
  async feedMove(position: { x?: number; y?: number; z?: number }, feedMmPerMin: number, timeoutMs = 60_000): Promise<void> {
    if (!Number.isFinite(feedMmPerMin) || feedMmPerMin <= 0) {
      throw new GrblStatusError('GRBL_INVALID_FEED', `Feed rate must be a positive number of mm/min, received ${feedMmPerMin}.`);
    }
    await this.sendLine(`${buildMove('G1', position)} F${feedMmPerMin}`, timeoutMs);
  }

  /** Feed hold (!) — pauses motion without losing position. */
  async feedHold(): Promise<void> {
    await this.transport.write(new TextEncoder().encode('!'));
  }

  /** Soft reset (ctrl-X 0x18) — clears buffers; does NOT replace a hardware e-stop. */
  async softReset(): Promise<void> {
    await this.transport.write(new Uint8Array([0x18]));
  }

  /** View G-code parser state ($G). */
  async parserState(timeoutMs = DEFAULT_TIMEOUT_MS): Promise<string> {
    await this.transport.write(new TextEncoder().encode('$G\n'));
    const line = await this.waitForLine((candidate) => candidate.startsWith('[GC:'), timeoutMs);
    return line.slice(4, -1);
  }

  // ---------------------------------------------------------------------------

  private async sendLine(line: string, timeoutMs: number): Promise<void> {
    await this.sendExpectOk(`${line}\n`, timeoutMs);
  }

  private async sendExpectOk(command: string, timeoutMs: number): Promise<void> {
    await this.transport.write(new TextEncoder().encode(`${command}\n`));
    const line = await this.waitForLine(
      (candidate) => candidate === 'ok' || candidate.startsWith('error:'),
      timeoutMs,
    );
    if (line.startsWith('error:')) {
      const code = Number.parseInt(line.slice(6), 10);
      throw new GrblError(code, GRBL_ERROR_MESSAGES[code] ?? `GRBL error ${code}`);
    }
  }

  private async waitForLine(predicate: (line: string) => boolean, timeoutMs: number): Promise<string> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      while (this.lineBuffer.length > 0) {
        const newlineIndex = this.lineBuffer.indexOf(0x0a);
        if (newlineIndex === -1) break;
        const bytes = this.lineBuffer.splice(0, newlineIndex + 1);
        const line = new TextDecoder()
          .decode(Uint8Array.from(bytes))
          .replace(/[\r\n]+$/, '')
          .trim();
        if (line.length > 0 && predicate(line)) return line;
      }
      if (Date.now() > deadline) {
        throw new GrblStatusError('GRBL_TIMEOUT', `No matching GRBL response within ${timeoutMs}ms.`);
      }
      if (this.closed && this.lineBuffer.length === 0) {
        throw new GrblStatusError('GRBL_CLOSED', 'GRBL transport closed while waiting for a response.');
      }
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
  }

  private async consume(): Promise<void> {
    try {
      for await (const chunk of this.transport.readable) {
        this.lineBuffer.push(...chunk);
        this.flushWaiters();
      }
    } catch {
      this.closed = true;
      this.flushWaiters();
    }
  }

  private flushWaiters(): void {
    if (this.lineBuffer.includes(0x0a)) {
      for (const waiter of this.waiters.splice(0)) waiter('');
    }
  }
}

function buildMove(code: 'G0' | 'G1', position: { x?: number; y?: number; z?: number }): string {
  const axes: string[] = [];
  for (const axis of ['x', 'y', 'z'] as const) {
    const value = position[axis];
    if (value === undefined) continue;
    if (!Number.isFinite(value)) {
      throw new GrblStatusError('GRBL_INVALID_POSITION', `Axis ${axis} must be a finite number of millimeters.`);
    }
    axes.push(`${axis.toUpperCase()}${value}`);
  }
  if (axes.length === 0) {
    throw new GrblStatusError('GRBL_INVALID_POSITION', 'At least one axis (x/y/z) in millimeters is required.');
  }
  return `${code} ${axes.join(' ')}`;
}

export function parseStatusLine(line: string): GrblMachineStatus {
  const inner = line.slice(1, -1);
  const [statePart, ...fieldParts] = inner.split('|');
  const status: GrblMachineStatus = { state: statePart ?? 'Unknown', raw: line };
  for (const field of fieldParts) {
    const colon = field.indexOf(':');
    if (colon === -1) continue;
    const key = field.slice(0, colon);
    const values = field.slice(colon + 1).split(',').map(Number);
    if (values.length === 3 && values.every((value) => Number.isFinite(value))) {
      const position = { x: values[0]!, y: values[1]!, z: values[2]! };
      if (key === 'MPos') status.mpos = position;
      if (key === 'WPos') status.wpos = position;
    }
  }
  return status;
}

export const GRBL_ERROR_MESSAGES: Record<number, string> = {
  1: 'G-code words consist of a letter and a value; the letter was not found.',
  8: 'Tool number greater than max supported.',
  9: 'Trailing characters found in command.',
  20: 'Unsupported or invalid g-code command.',
  22: 'Feed rate not set (G1/G2/G3 require F).',
  33: 'Motion target exceeds machine travel (soft limits).',
};
