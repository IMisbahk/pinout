export { ModuleHost, ModuleProcess, ModuleDeadError, ModuleCrashedError } from './moduleHost.js';
export type { ModuleSpawnSpec, ModuleProcessState, InvokeOptions } from './moduleHost.js';
export { encodeMessage, decodeMessage, MODULE_IPC_VERSION } from './protocol.js';
export type { ModuleIpcRequest, ModuleIpcResponse, ModuleIpcMessage } from './protocol.js';
export { parseModulePermissions, auditPermissions } from './permissions.js';
export type { ModulePermissions, PermissionFinding } from './permissions.js';
export {
  contentHash,
  manifestHash,
  signModule,
  verifyModule,
  writeSignature,
  generatePublisherKeyPair,
  hashContent,
} from './integrity.js';
export type { IntegrityReport, IntegrityStatus, ModuleSignature } from './integrity.js';
export {
  evaluateConformanceLevel,
  conformanceRecord,
  CONFORMANCE_LEVELS,
  LEVEL_NAMES,
} from './conformanceLevels.js';
export type { ConformanceLevel, ConformanceEvidence } from './conformanceLevels.js';
