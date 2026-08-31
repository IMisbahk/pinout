export { connect } from './connect.js';
export { Device } from './device.js';
export { simulatedEsp32 } from './drivers/esp32/simulatedTransport.js';
export { loopbackTransport, LoopbackTransport } from './transports/loopbackTransport.js';
export { tcpTransport } from './transports/tcpTransport.js';
export { describeCapabilities, toAgentTools } from './capabilities.js';
export {
  PinoutError,
  ValidationError,
  UnsupportedCapabilityError,
  TransportError,
  TimeoutError,
  ProtocolError,
  DisconnectedError,
  DeviceError,
} from './errors.js';
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
export { handleBridgeAction, esp32BridgeInfo, createGpioState } from './drivers/esp32/bridge.js';
export {
  assertEsp32ReadPin,
  assertEsp32WritePin,
  assertGpioPin,
  assertGpioValue,
  esp32DefaultLedPin,
  isEsp32StrapPin,
} from './drivers/esp32/pins.js';

export type {
  Transport,
  ConnectOptions,
  CapabilityDescriptor,
  CapabilitySafety,
  DeviceInfo,
  AgentTool,
  JsonSchema,
} from './types.js';
