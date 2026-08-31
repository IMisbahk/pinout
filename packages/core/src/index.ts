export { connect } from './connect.js';
export { loadPinoutConfig } from './config.js';
export { Device } from './device.js';
export { simulatedEsp32 } from './drivers/esp32/simulatedTransport.js';
export { listSerialPorts, serialPort } from './serial.js';
export { loopbackTransport, LoopbackTransport } from './transports/loopbackTransport.js';
export { tcpTransport } from './transports/tcpTransport.js';
export {
  capabilityCatalog,
  describeCapabilities,
  describeCapability,
  firstPartyCapabilities,
  gpioAnalogReadCapability,
  gpioModeCapability,
  gpioPulseCapability,
  gpioPwmCapability,
  gpioReadCapability,
  gpioToggleCapability,
  gpioUnwatchCapability,
  gpioWatchCapability,
  gpioWriteCapability,
  sysHelloCapability,
  sysInfoCapability,
  sysPingCapability,
  toAgentTools,
} from './capabilities.js';
export {
  PinoutError,
  ValidationError,
  UnsupportedCapabilityError,
  TransportError,
  TimeoutError,
  ProtocolError,
  DisconnectedError,
  DeviceError,
  AbortedError,
} from './errors.js';
export { createLogger } from './logger.js';
export {
  decodeLine,
  encodeEvent,
  encodeFailure,
  encodeRequest,
  encodeResponse,
  maxProtocolLineBytes,
  parseLine,
  protocolVersion,
} from './protocol.js';
export {
  esp32BridgeActions,
  esp32BridgeCapabilities,
  handleBridgeAction,
  esp32BridgeInfo,
  createGpioState,
  readPinLevel,
  setPinLevel,
} from './drivers/esp32/bridge.js';
export {
  assertEsp32AdcPin,
  assertEsp32AnalogPin,
  assertEsp32ModePin,
  assertEsp32PwmPin,
  assertEsp32ReadPin,
  assertEsp32WritePin,
  assertGpioMode,
  assertGpioPin,
  assertGpioValue,
  esp32AdcPins,
  esp32DefaultLedPin,
  esp32DevKitPins,
  esp32StrapPins,
  isEsp32StrapPin,
  resolveEsp32BoardPin,
} from './drivers/esp32/pins.js';
export { esp32DevKitPinMap, resolveEsp32DevKitPin } from './drivers/esp32/boardMap.js';

export type {
  Transport,
  ConnectOptions,
  CapabilityDescriptor,
  CapabilitySafety,
  DeviceEventHandler,
  DeviceInfo,
  AgentTool,
  JsonSchema,
  RequestOptions,
} from './types.js';
export type { LogContext, LogLevel, Logger } from './logger.js';
export type { PinoutEnvConfig } from './config.js';
