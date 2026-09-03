import { ScpiUsageError } from '../errors.js';
import { ScpiInstrument } from './scpiInstrument.js';

export type WaveformName = 'sine' | 'square' | 'ramp' | 'noise';

const WAVEFORM_MNEMONICS: Readonly<Record<WaveformName, string>> = {
  sine: 'SIN',
  square: 'SQU',
  ramp: 'RAMP',
  noise: 'NOIS',
};

/**
 * Function generator over standard SCPI source commands:
 * `:SOUR<ch>:FREQ`, `:SOUR<ch>:VOLT`, `:SOUR<ch>:FUNC <shape>`, `:OUTP<ch> ON|OFF`.
 * The output channel is optional and defaults to 1.
 */
export class FunctionGenerator extends ScpiInstrument {
  /** Set the output frequency in hertz: `:SOUR<ch>:FREQ <hz>`. */
  async setFrequency(hertz: number, channel = 1): Promise<void> {
    const ch = this.assertChannel(channel);
    await this.client.command(`:SOUR${String(ch)}:FREQ ${this.formatValue(hertz, 'Frequency')}`);
  }

  /** Set the output amplitude in volts peak-to-peak: `:SOUR<ch>:VOLT <volts>`. */
  async setAmplitude(volts: number, channel = 1): Promise<void> {
    const ch = this.assertChannel(channel);
    await this.client.command(`:SOUR${String(ch)}:VOLT ${this.formatValue(volts, 'Amplitude')}`);
  }

  /** Select the output shape: `:SOUR<ch>:FUNC SIN|SQU|RAMP|NOIS`. */
  async setWaveform(waveform: WaveformName, channel = 1): Promise<void> {
    const ch = this.assertChannel(channel);
    const mnemonic = WAVEFORM_MNEMONICS[waveform];
    if (mnemonic === undefined) {
      throw new ScpiUsageError(
        `Unknown waveform '${String(waveform)}'. Expected sine, square, ramp, or noise.`,
      );
    }
    await this.client.command(`:SOUR${String(ch)}:FUNC ${mnemonic}`);
  }

  /** Turn the output on: `:OUTP<ch> ON`. */
  async enableOutput(channel = 1): Promise<void> {
    const ch = this.assertChannel(channel);
    await this.client.command(`:OUTP${String(ch)} ON`);
  }

  /** Turn the output off: `:OUTP<ch> OFF`. */
  async disableOutput(channel = 1): Promise<void> {
    const ch = this.assertChannel(channel);
    await this.client.command(`:OUTP${String(ch)} OFF`);
  }
}
