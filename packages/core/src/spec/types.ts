/**
 * Canonical Pinout spec types (spec v1).
 *
 * These are the semantic contracts shared by the runtime, transports,
 * protocols, SDKs, simulators, and agent interfaces. Implementation types in
 * the runtime may extend these, but the serialized shapes here are the
 * cross-boundary contract.
 */

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

/** ISO-8601 timestamp or epoch milliseconds depending on context; prefer `Timestamped`. */
export type Timestamp = number;

export interface Timestamped {
  /** Wall-clock time of the observation, in epoch milliseconds. */
  at: number;
}

export type Quality = 'good' | 'degraded' | 'bad' | 'unknown';

/** An explicit unit. Canonical SI-ish spellings; conversions live in `units.ts`. */
export type Unit =
  | 'm'
  | 'mm'
  | 'cm'
  | 'km'
  | 'rad'
  | 'deg'
  | 'rev'
  | 'm/s'
  | 'mm/s'
  | 'rad/s'
  | 'deg/s'
  | 'rpm'
  | 'm/s2'
  | 'rad/s2'
  | 'N'
  | 'N.m'
  | 'kg'
  | 'g'
  | 'C'
  | 'F'
  | 'K'
  | 'V'
  | 'mV'
  | 'A'
  | 'mA'
  | 'W'
  | 'Pa'
  | 'kPa'
  | 'bar'
  | 'psi'
  | 'Hz'
  | 'percent'
  | 'lux'
  | 'counts'
  | 'bool'
  | 'string';

export interface Measurement {
  /** Numeric value, or `null` when the measurement is genuinely unknown. */
  value: number | null;
  /** Unit of `value`. Never omit: unknown is better than a silent default. */
  unit: Unit;
  quality: Quality;
  at: number;
}

// ---------------------------------------------------------------------------
// Device identity and descriptors
// ---------------------------------------------------------------------------

/**
 * A coarse, stable category used for capability packs and discovery.
 * Namespaced: `gpio`, `sensor.temperature`, `robot.manipulator`,
 * `instrument.power-supply`, `industrial.plc`, etc.
 */
export type DeviceClass = string;

export interface DeviceIdentity {
  id: string;
  moduleId: string;
  deviceClass: DeviceClass;
  vendor?: string;
  model?: string;
  label?: string;
  /** Firmware/OS version reported by the device, when known. */
  firmwareVersion?: string;
}

export type DeviceLifecycleStatus =
  'connecting' | 'ready' | 'busy' | 'faulted' | 'stopped' | 'disconnected';

export type DeviceHealthStatus = 'CONNECTED' | 'DEGRADED' | 'FAULTED' | 'DISCONNECTED' | 'UNKNOWN';

export interface DeviceHealth {
  status: DeviceHealthStatus;
  lifecycle: DeviceLifecycleStatus;
  message?: string;
  lastUpdated: number;
}

export interface DeviceFault {
  code: string;
  message: string;
  at: number;
  /** True when the runtime believes the fault can be cleared by software. */
  clearable: boolean;
  details?: Record<string, unknown>;
}

export interface Diagnostic {
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  at: number;
  source?: string;
  details?: Record<string, unknown>;
}

/**
 * One enumerable device instance inside the DeviceGraph. Devices may be
 * physical backends, virtual devices, or composed containers.
 */
export interface DeviceDescriptor {
  identity: DeviceIdentity;
  capabilities: string[];
  health: DeviceHealth;
  /** Logical/virtual devices are simulated: `true` until hardware-proven. */
  simulated: boolean;
  /** IDs of child devices (composition). Empty for leaf devices. */
  children: string[];
  /** ID of the parent device, if this is a component of a larger system. */
  parent?: string;
  tags: string[];
  transport: TransportDescriptor;
  support: SupportStatus;
}

export interface TransportDescriptor {
  kind: string;
  /** Human-meaningful endpoint, e.g. `/dev/cu.usbserial-1420` or `tcp:host:port`. */
  endpoint?: string;
  /** Baud rate, serial config, etc. — transport-specific, kept as data. */
  options?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Capabilities
// ---------------------------------------------------------------------------

export type CapabilityKind = 'action' | 'sensor' | 'stream' | 'state' | 'event';

/**
 * How physically consequential a capability is. Descriptive metadata only —
 * enforcement is the policy engine's job. A language model must never be the
 * arbiter of whether a call is safe.
 */
export type DangerLevel = 'READ_ONLY' | 'LOW_RISK' | 'PHYSICAL_SIDE_EFFECT' | 'HIGH_RISK';

export type RealTimeClass =
  /** Deterministic loops run on-device or in firmware; never by an LLM. */
  | 'realtime'
  /** High-level intent like motion.move_to; executed by deterministic runtime code. */
  | 'high_level'
  | 'non_realtime';

export interface CapabilityArgument {
  name: string;
  description: string;
  schema: Record<string, unknown>;
  /** Canonical unit for numeric arguments; required for physical quantities. */
  unit?: Unit;
  required: boolean;
  default?: unknown;
}

export interface CapabilityResult {
  description: string;
  schema: Record<string, unknown>;
  unit?: Unit;
}

export interface CapabilityBase {
  id: string;
  name: string;
  description: string;
  kind: CapabilityKind;
  danger: DangerLevel;
  /** True when repeated invocation with the same arguments is equivalent to one invocation. */
  idempotent: boolean;
  /** Typical duration class, so agents can plan polling vs. awaiting. */
  duration: 'immediate' | 'short' | 'long_running';
  realTimeClass: RealTimeClass;
  cancellable: boolean;
  /** Permissions required (see Permission). */
  requiredPermissions: string[];
  /** State that must hold before invocation, e.g. `{ door: 'closed' }`. */
  requiredState?: Record<string, unknown>;
  /** State transition produced by a successful invocation. */
  producesState?: Record<string, unknown>;
  arguments: CapabilityArgument[];
  result: CapabilityResult;
  /** Maximum sustained invocation rate, per device, in requests/second. */
  rateLimitPerSecond?: number;
  /** How the capability's outputs arrive: none, inline result, or via events/streams. */
  streaming: 'none' | 'events' | 'stream';
}

export interface ActionCapability extends CapabilityBase {
  kind: 'action';
}

export interface SensorCapability extends CapabilityBase {
  kind: 'sensor';
  unit: Unit;
  /** Minimum interval between successful reads, milliseconds. */
  minIntervalMs?: number;
}

export interface StreamCapability extends CapabilityBase {
  kind: 'stream';
  /** Frames per second or hertz of the underlying stream. */
  nominalRateHz?: number;
  codec?: string;
}

export interface StateCapability extends CapabilityBase {
  kind: 'state';
  /** Keys of the operational state this capability reads or writes. */
  fields: string[];
}

export interface EventCapability extends CapabilityBase {
  kind: 'event';
  /** Event names emitted, e.g. `motion.completed`. */
  events: string[];
}

export type Capability =
  ActionCapability | SensorCapability | StreamCapability | StateCapability | EventCapability;

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

export type OperationStatus =
  | 'queued'
  | 'running'
  /** Cancellation was requested; the backend has not yet acknowledged it. */
  | 'cancelling'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'timed_out'
  | 'rejected'
  | 'requires_reconciliation'
  | 'uncertain'
  | 'aborted'
  | 'stop_unconfirmed';

export interface OperationProgress {
  /** 0..1, or `null` when the device cannot report determinate progress. */
  fraction: number | null;
  message?: string;
  at: number;
}

export interface OperationError {
  code: string;
  message: string;
  retryable: boolean;
  details?: Record<string, unknown>;
}

export interface OperationSnapshot {
  id: string;
  deviceId: string;
  capability: string;
  status: OperationStatus;
  /** Caller-supplied key; duplicate keys dedupe instead of re-executing. */
  idempotencyKey?: string;
  createdAt: number;
  startedAt?: number;
  /** Timestamp of a cooperative cancellation request, if any. */
  cancelRequestedAt?: number;
  finishedAt?: number;
  deadline?: number;
  progress: OperationProgress | null;
  result?: Record<string, unknown>;
  error?: OperationError;
}

// ---------------------------------------------------------------------------
// Leases
// ---------------------------------------------------------------------------

export type LeaseMode = 'exclusive' | 'shared-read';

export type LeaseScope =
  | { kind: 'device'; deviceId: string }
  | { kind: 'capability'; deviceId: string; capabilities: string[] };

export interface Lease {
  id: string;
  mode: LeaseMode;
  scope: LeaseScope;
  owner: string;
  createdAt: number;
  expiresAt: number;
  /** True when `renew()` has been called since the last tick. */
  renewable: boolean;
}

// ---------------------------------------------------------------------------
// Frames and poses
// ---------------------------------------------------------------------------

export interface Vector3 {
  x: number;
  y: number;
  z: number;
}

export interface Quaternion {
  x: number;
  y: number;
  z: number;
  w: number;
}

export interface Pose {
  position: Vector3;
  orientation: Quaternion;
}

export type CoordinateFrame =
  'world' | 'base' | 'tool0' | 'tcp' | 'camera' | 'workpiece' | (string & {});

/**
 * A pose qualified by its frame. Coordinates in different frames are NEVER
 * interchangeable without a transform.
 */
export interface FrameReference {
  frame: CoordinateFrame;
  pose: Pose;
}

export interface Transform {
  from: CoordinateFrame;
  to: CoordinateFrame;
  translation: Vector3;
  rotation: Quaternion;
  at: number;
}

// ---------------------------------------------------------------------------
// Safety
// ---------------------------------------------------------------------------

export type ConstraintProvenance =
  /** Documented by the vendor/manual — strongest. */
  | 'DOCUMENTED'
  /** Configured by the deployment operator. */
  | 'CONFIGURED'
  /** Inferred by tooling; not automatically a hard rule. */
  | 'INFERRED'
  | 'UNKNOWN'
  /** Two sources disagree; requires human review before hard enforcement. */
  | 'CONFLICTED';

export interface SafetyConstraint {
  /** Stable rule id, e.g. `temperature.max`. */
  id: string;
  description: string;
  capability?: string;
  field?: string;
  min?: number;
  max?: number;
  unit?: Unit;
  provenance: ConstraintProvenance;
}

export interface PolicyDecision {
  allowed: boolean;
  /** Machine-readable reason when rejected; never expect agents to parse prose. */
  code?: string;
  message?: string;
  ruleId?: string;
}

// ---------------------------------------------------------------------------
// Permissions and modules
// ---------------------------------------------------------------------------

export type ModulePermission =
  | { kind: 'serial'; vendorIds: number[]; productIds: number[] }
  | { kind: 'network'; hosts: string[]; ports: number[] }
  | { kind: 'usb'; vendorIds: number[]; productIds: number[] }
  | { kind: 'filesystem'; read: string[]; write: string[] }
  | { kind: 'environment'; keys: string[] }
  | { kind: 'subprocess' }
  | { kind: 'bluetooth' }
  | { kind: 'gpio'; interfaces: string[] };

export type SupportStatus =
  /** Code exists and behaves per contract; not hardware-proven. */
  | 'IMPLEMENTED'
  /** Tested against real hardware, with date and versions recorded. */
  | 'HARDWARE_VERIFIED'
  /** Runs inside the simulator; same contracts, fake physics. */
  | 'SIMULATED'
  /** Compiled for the target but not behavior-tested. */
  | 'COMPILE_TESTED'
  /** Design exists; no implementation yet. */
  | 'PLANNED'
  /** Usable, but interfaces may change. */
  | 'EXPERIMENTAL';

export interface ModuleManifestV1 {
  schemaVersion: 1;
  id: string;
  version: string;
  publisher?: string;
  deviceClass: DeviceClass;
  runtime: 'node' | 'python';
  capabilities: string[];
  /** Minimum Pinout version this module works with. */
  entrypoint: string;
  pinout?: { minimumVersion?: string; maximumMajor?: number };
  permissions?: ModulePermission[];
  simulation: { provided: boolean; simulator?: string; notes?: string };
  status: 'CANDIDATE' | 'REVIEWED' | 'TESTED';
  provenance?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface SimulationDescriptor {
  /** Simulator implementation id, e.g. `pinout.sim.physics-cartoon`. */
  simulator: string;
  /** Simulator-provided constraint notes: not hard safety rules. */
  notes?: string;
}
