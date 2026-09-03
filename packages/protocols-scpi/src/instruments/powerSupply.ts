import type { ScpiClient } from '../client.js';
import type { ScpiInstrumentOptions } from './scpiInstrument.js';
import { ScpiInstrument } from './scpiInstrument.js';

/**
 * Programmable DC power supply over standard SCPI:
 * `:VOLT<ch>`, `:CURR<ch>`, `:OUTP<ch> ON|OFF`, `:MEAS:VOLT<ch>?`, `:MEAS:CURR<ch>?`,
 * `:MEAS:POW<ch>?`. Channels are 1-based.
 */
export class PowerSupply extends ScpiInstrument {
  constructor(client: ScpiClient, options?: ScpiInstrumentOptions) {
    super(client, options);
  }

  /** Program the output voltage limit: `:VOLT<ch> <volts>`. */
  async setVoltage(channel: number, volts: number): Promise<void> {
    const ch = this.assertChannel(channel);
    await this.client.command(`:VOLT${String(ch)} ${this.formatValue(volts, 'Voltage')}`);
  }

  /** Program the output current limit: `:CURR<ch> <amps>`. */
  async setCurrent(channel: number, amps: number): Promise<void> {
    const ch = this.assertChannel(channel);
    await this.client.command(`:CURR${String(ch)} ${this.formatValue(amps, 'Current')}`);
  }

  /** Turn the channel output on: `:OUTP<ch> ON`. */
  async enableOutput(channel: number): Promise<void> {
    const ch = this.assertChannel(channel);
    await this.client.command(`:OUTP${String(ch)} ON`);
  }

  /** Turn the channel output off: `:OUTP<ch> OFF`. */
  async disableOutput(channel: number): Promise<void> {
    const ch = this.assertChannel(channel);
    await this.client.command(`:OUTP${String(ch)} OFF`);
  }

  /** Measure the actual output voltage: `:MEAS:VOLT<ch>?`. */
  async readVoltage(channel: number): Promise<number> {
    const ch = this.assertChannel(channel);
    return this.client.queryNumber(`:MEAS:VOLT${String(ch)}?`);
  }

  /** Measure the actual output current: `:MEAS:CURR<ch>?`. */
  async readCurrent(channel: number): Promise<number> {
    const ch = this.assertChannel(channel);
    return this.client.queryNumber(`:MEAS:CURR${String(ch)}?`);
  }

  /** Measure the output power: `:MEAS:POW<ch>?`. */
  async readPower(channel: number): Promise<number> {
    const ch = this.assertChannel(channel);
    return this.client.queryNumber(`:MEAS:POW${String(ch)}?`);
  }
}
