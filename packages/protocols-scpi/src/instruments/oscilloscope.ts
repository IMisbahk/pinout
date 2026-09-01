import { parseScpiNumber, formatScpiNumber } from '../parser.js';
import { ScpiResponseError, ScpiUsageError } from '../errors.js';
import { ScpiInstrument } from './scpiInstrument.js';

export interface OscilloscopeChannelSettings {
  /** Show/hide the channel: `:CHAN<ch>:DISP ON|OFF`. */
  enabled?: boolean;
  /** Vertical coupling: `:CHAN<ch>:COUP DC|AC`. */
  coupling?: 'dc' | 'ac';
  /** Vertical scale in volts per division: `:CHAN<ch>:SCAL <volts>`. */
  voltsPerDivision?: number;
}

export type WaveformDataFormat = 'ascii' | 'byte';

export interface CaptureWaveformOptions {
  /** Source channel (1-based, default 1). */
  channel?: number;
  /**
   * `ascii` (default) sends `:WAV:FORM ASC` and parses comma-separated
   * numbers; `byte` sends `:WAV:FORM BYTE` and returns the raw block bytes.
   * Binary acquisition quality (scaling, offsets, packing) is vendor-specific.
   */
  format?: WaveformDataFormat;
}

export interface ScpiWaveformMetadata {
  channel: number;
  format: WaveformDataFormat;
  points: number;
}

export interface ScpiWaveform {
  data: number[] | Uint8Array;
  metadata: ScpiWaveformMetadata;
}

const COUPLINGS = new Set(['AC', 'DC']);

function parseDefiniteLengthBlock(response: string): { payload: string } {
  // IEEE 488.2 definite-length block: `#<n><n header digits><payload>`, where
  // the single digit n counts the header digits that encode the payload length.
  if (!/^#\d/.test(response)) {
    throw new ScpiResponseError(
      "Waveform response starts with '#' but is not a definite-length block.",
    );
  }
  const headerDigitCount = Number.parseInt(response.charAt(1), 10);
  if (headerDigitCount === 0) {
    throw new ScpiResponseError('Indefinite-length waveform blocks are not supported.');
  }
  const lengthStart = 2;
  const declaredLength = Number.parseInt(
    response.slice(lengthStart, lengthStart + headerDigitCount),
    10,
  );
  if (!Number.isInteger(declaredLength) || declaredLength < 0) {
    throw new ScpiResponseError('Waveform block has an invalid declared length.');
  }
  const payloadStart = lengthStart + headerDigitCount;
  return {
    payload: response.slice(payloadStart, payloadStart + declaredLength),
  };
}

function parseAsciiWaveform(payload: string): number[] {
  const data: number[] = [];
  for (const token of payload.split(',')) {
    const trimmed = token.trim();
    if (trimmed.length === 0) {
      continue;
    }
    data.push(parseScpiNumber(trimmed));
  }
  return data;
}

/**
 * Oscilloscope over a CONSERVATIVE, widely implemented SCPI subset:
 * `:CHAN<ch>:DISP`, `:CHAN<ch>:COUP`, `:CHAN<ch>:SCAL` for configuration and
 * the `:WAV` subsystem (`:WAV:SOUR CHAN<ch>`, `:WAV:FORM ASC|BYTE`, `:WAV:DATA?`)
 * for capture.
 *
 * This is deliberately minimal: trigger configuration, timebase, acquisition
 * modes, and scaling of binary waveform data differ substantially between
 * vendors (Keysight/Rigol `:WAV*`, Tektronix `:DATA*`, ...) and need a
 * dedicated vendor module — use `raw()` (opt-in) in the meantime.
 */
export class Oscilloscope extends ScpiInstrument {
  /** Apply display/coupling/scale settings; only provided fields are sent. */
  async configureChannel(channel: number, settings: OscilloscopeChannelSettings): Promise<void> {
    const ch = this.assertChannel(channel);
    if (settings.enabled !== undefined) {
      await this.client.command(`:CHAN${String(ch)}:DISP ${settings.enabled ? 'ON' : 'OFF'}`);
    }
    if (settings.coupling !== undefined) {
      const coupling = settings.coupling.toUpperCase();
      if (!COUPLINGS.has(coupling)) {
        throw new ScpiUsageError(`Coupling must be 'dc' or 'ac'; received '${settings.coupling}'.`);
      }
      await this.client.command(`:CHAN${String(ch)}:COUP ${coupling}`);
    }
    if (settings.voltsPerDivision !== undefined) {
      const scale = this.assertFinite(settings.voltsPerDivision, 'Volts per division');
      await this.client.command(`:CHAN${String(ch)}:SCAL ${formatScpiNumber(scale)}`);
    }
  }

  /**
   * Capture the waveform of one channel.
   *
   * Sequence: `:WAV:SOUR CHAN<ch>`, `:WAV:FORM ASC|BYTE`, `:WAV:DATA?`.
   * ASCII responses (optionally wrapped in a 488.2 definite-length block) are
   * parsed into `number[]`; byte responses become a `Uint8Array` of raw block
   * bytes. The result is UNSCALED sample data — converting to volts requires
   * the instrument's preamble, which is vendor-specific.
   */
  async captureWaveform(options?: CaptureWaveformOptions): Promise<ScpiWaveform> {
    const ch = this.assertChannel(options?.channel ?? 1);
    const format = options?.format ?? 'ascii';
    await this.client.command(`:WAV:SOUR CHAN${String(ch)}`);
    await this.client.command(format === 'byte' ? ':WAV:FORM BYTE' : ':WAV:FORM ASC');
    const response = await this.client.query(':WAV:DATA?');
    const trimmed = response.trim();
    const payload = trimmed.startsWith('#') ? parseDefiniteLengthBlock(trimmed).payload : trimmed;
    if (format === 'byte') {
      const bytes = new Uint8Array(payload.length);
      for (let i = 0; i < payload.length; i += 1) {
        bytes[i] = payload.charCodeAt(i) & 0xff;
      }
      return { data: bytes, metadata: { channel: ch, format, points: bytes.length } };
    }
    const data = parseAsciiWaveform(payload);
    return { data, metadata: { channel: ch, format: 'ascii', points: data.length } };
  }
}
