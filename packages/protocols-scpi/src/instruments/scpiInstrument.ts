import type { ScpiClient } from '../client.js';
import { formatScpiNumber } from '../parser.js';
import { ScpiRawDisabledError, ScpiUsageError } from '../errors.js';

export interface ScpiInstrumentOptions {
  /**
   * Opt in to the `raw()` escape hatch. Default `false`: canonical instrument
   * classes only speak the standard command surface unless you explicitly
   * allow vendor-specific commands.
   */
  allowRaw?: boolean;
}

/**
 * Shared base for the canonical SCPI instrument classes.
 *
 * These classes are deliberately built ONLY on IEEE 488.2 common commands and
 * standard/ubiquitous SCPI subsystems — no vendor quirks. Vendor-specific
 * behavior belongs in dedicated modules and must go through `raw()`.
 */
export abstract class ScpiInstrument {
  protected readonly client: ScpiClient;
  private readonly allowRaw: boolean;

  constructor(client: ScpiClient, options?: ScpiInstrumentOptions) {
    this.client = client;
    this.allowRaw = options?.allowRaw ?? false;
  }

  /**
   * FOR HUMAN PROGRAMS — escape hatch for vendor-specific commands.
   *
   * Sends an arbitrary SCPI program message and resolves with the response
   * line for queries, or `undefined` for non-queries. Requires constructing
   * the instrument with `{ allowRaw: true }`; anything sent here bypasses the
   * portable command surface and may be device-specific.
   */
  async raw(command: string): Promise<string | undefined> {
    if (!this.allowRaw) {
      throw new ScpiRawDisabledError();
    }
    return this.client.execute(command);
  }

  /** SCPI channel suffixes are 1-based integers. */
  protected assertChannel(channel: number): number {
    if (!Number.isInteger(channel) || channel < 1) {
      throw new ScpiUsageError(`Channel must be an integer >= 1; received ${String(channel)}.`);
    }
    return channel;
  }

  /** SCPI numeric arguments must be finite. */
  protected assertFinite(value: number, label: string): number {
    if (!Number.isFinite(value)) {
      throw new ScpiUsageError(`${label} must be a finite number; received ${String(value)}.`);
    }
    return value;
  }

  protected formatValue(value: number, label: string): string {
    return formatScpiNumber(this.assertFinite(value, label));
  }
}
