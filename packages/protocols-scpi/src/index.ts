export { ScpiClient } from './client.js';
export type { ScpiClientOptions, ScpiRequestOptions, ScpiIdentity } from './client.js';
export type { ScpiErrorQueueEntry } from './parser.js';
export {
  expandMnemonic,
  formatScpiNumber,
  parseScpiCommand,
  parseScpiErrorQueueLine,
  parseScpiNumber,
  scpiCommandKey,
} from './parser.js';
export type { ScpiCommand } from './parser.js';
export {
  ScpiClosedError,
  ScpiError,
  ScpiParseError,
  ScpiRawDisabledError,
  ScpiResponseError,
  ScpiTimeoutError,
  ScpiUsageError,
} from './errors.js';
export { ScpiInstrument } from './instruments/scpiInstrument.js';
export type { ScpiInstrumentOptions } from './instruments/scpiInstrument.js';
export { PowerSupply } from './instruments/powerSupply.js';
export { DigitalMultimeter } from './instruments/digitalMultimeter.js';
export type { MeasurementMode } from './instruments/digitalMultimeter.js';
export { FunctionGenerator } from './instruments/functionGenerator.js';
export type { WaveformName } from './instruments/functionGenerator.js';
export { Oscilloscope } from './instruments/oscilloscope.js';
export type {
  CaptureWaveformOptions,
  OscilloscopeChannelSettings,
  ScpiWaveform,
  ScpiWaveformMetadata,
  WaveformDataFormat,
} from './instruments/oscilloscope.js';
