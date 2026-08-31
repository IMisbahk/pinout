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
export {
  PolicyError,
  PolicyConstraintViolation,
  PolicyPreconditionFailed,
  PolicyActionDenied,
} from './policy/errors.js';
export { validateInputSchema } from './schema.js';
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
export { PinoutRuntime, DuplicateDeviceError, DeviceNotFoundError } from './runtime/runtime.js';
export { createRuntimeFromConfig, type FromConfigOptions } from './runtime/fromConfig.js';
export { PINOUT_VERSION } from './version.js';
export {
  defineModule,
  type DefineModuleInput,
  type ModuleDeviceMetadata,
} from './module/defineModule.js';
export { action, sensorRead, type ActionInput } from './module/action.js';
export {
  policiesFromDeclarative,
  mergeModulePolicies,
  type DeclarativePolicyMap,
} from './module/policies.js';
export {
  runModuleConformance,
  formatConformanceReport,
  type ConformanceResult,
} from './module/conformance.js';
export {
  MODULE_MANIFEST_FILENAME,
  parseModuleManifest,
  readModuleManifestFromFile,
} from './module/manifest.js';
export { loadModuleFromDirectory, type LoadedModule } from './module/loadModule.js';
export {
  ModuleNotFoundError,
  ModuleAlreadyInstalledError,
  ModuleInvalidError,
  ModuleIncompatibleError,
  ModuleLoadFailedError,
  DeviceAlreadyExistsError,
  DeviceConfigInvalidError,
  DeviceBackendFailedError,
} from './module/errors.js';
export {
  ensurePinoutHome,
  installModuleFromPath,
  uninstallModule,
  inspectInstalledModule,
  readModulesIndex,
  type InstalledModuleRecord,
} from './home/moduleStore.js';
export {
  readDevicesFile,
  writeDevicesFile,
  addDeviceDefinition,
  removeDeviceDefinition,
  inspectDeviceDefinition,
  type DeviceDefinition,
  type DevicesFile,
} from './home/deviceStore.js';
export {
  resolvePinoutHome,
  resolveDevicesConfigPath,
  PINOUT_HOME_ENV,
  PINOUT_CONFIG_ENV,
} from './home/paths.js';
export {
  listAvailableModules,
  ensureModuleLoaded,
  loadAllInstalledModules,
  resetRuntimeModulesForTests,
} from './modules/registry.js';
export { DeviceInstance } from './runtime/deviceInstance.js';
export {
  createHeterogeneousRuntime,
  defaultHeterogeneousDeviceIds,
} from './runtime/createHeterogeneousRuntime.js';
export {
  runtimeToAgentTools,
  deviceToRuntimeAgentTools,
  buildMcpToolName,
  type RuntimeAgentTool,
} from './runtime/agentTools.js';
export { getModule, listModules, registerModule } from './modules/registry.js';
export {
  esp32Module,
  esp32ModuleId,
  createEsp32SimulatedTransport,
} from './modules/esp32Module.js';
export { robotArmModule, robotArmModuleId } from './modules/robotArmModule.js';
export { chamberModule, chamberModuleId } from './modules/chamberModule.js';
export { createSimulatedRobotArmBackend } from './modules/robotArm/simulator.js';
export { createSimulatedChamberBackend } from './modules/chamber/simulator.js';
export { evaluatePolicies } from './policy/engine.js';

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
export type {
  DeviceClass,
  DeviceIdentity,
  DeviceHealth,
  DeviceDescriptor,
  DeviceSummary,
  DeviceLifecycleStatus,
  RuntimeEventEnvelope,
  RuntimeEventHandler,
  PinoutModuleDefinition,
  RegisterModuleDeviceOptions,
  DeviceBackend,
} from './runtime/types.js';
export type { PolicyRule, PolicyContext } from './policy/types.js';
export type { LogContext, LogLevel, Logger } from './logger.js';
export type { PinoutEnvConfig } from './config.js';
