import { ScpiInstrument } from './scpiInstrument.js';

export type MeasurementMode = 'dc' | 'ac';

/**
 * Digital multimeter over standard SCPI measure queries:
 * `:MEAS:VOLT:DC?`, `:MEAS:VOLT:AC?`, `:MEAS:CURR:DC?`, `:MEAS:CURR:AC?`,
 * `:MEAS:RES?`. All methods block until the measurement response arrives.
 */
export class DigitalMultimeter extends ScpiInstrument {
  /** Measure DC or AC voltage: `:MEAS:VOLT:DC?` / `:MEAS:VOLT:AC?`. */
  async measureVoltage(mode: MeasurementMode = 'dc'): Promise<number> {
    return this.client.queryNumber(mode === 'ac' ? ':MEAS:VOLT:AC?' : ':MEAS:VOLT:DC?');
  }

  /** Measure DC or AC current: `:MEAS:CURR:DC?` / `:MEAS:CURR:AC?`. */
  async measureCurrent(mode: MeasurementMode = 'dc'): Promise<number> {
    return this.client.queryNumber(mode === 'ac' ? ':MEAS:CURR:AC?' : ':MEAS:CURR:DC?');
  }

  /** Measure resistance: `:MEAS:RES?` (2-wire ohms on most instruments). */
  async measureResistance(): Promise<number> {
    return this.client.queryNumber(':MEAS:RES?');
  }
}
