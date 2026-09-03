export class PinoutError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = this.constructor.name;
    this.code = code;
  }
}

export class ValidationError extends PinoutError {
  constructor(message: string, options?: ErrorOptions) {
    super('VALIDATION_ERROR', message, options);
  }
}

export class UnsupportedCapabilityError extends PinoutError {
  readonly action: string;

  constructor(action: string) {
    super('UNSUPPORTED_CAPABILITY', `This device does not support '${action}'.`);
    this.action = action;
  }
}

export class TransportError extends PinoutError {
  constructor(message: string, options?: ErrorOptions) {
    super('TRANSPORT_ERROR', message, options);
  }
}

export class TimeoutError extends PinoutError {
  constructor(message = 'Timed out waiting for a device response.') {
    super('TIMEOUT', message);
  }
}

export class ProtocolError extends PinoutError {
  constructor(message: string, options?: ErrorOptions) {
    super('PROTOCOL_ERROR', message, options);
  }
}

export class DisconnectedError extends PinoutError {
  constructor(message = 'The device is not connected.') {
    super('DISCONNECTED', message);
  }
}

export class AbortedError extends PinoutError {
  constructor(message = 'The request was aborted.') {
    super('ABORTED', message);
  }
}

export class DeviceError extends PinoutError {
  readonly details: unknown;

  constructor(code: string, message: string, details?: unknown) {
    super(code, message);
    this.details = details;
  }
}

// ---------------------------------------------------------------------------
// Stable error taxonomy (spec v1)
//
// Errors crossing a boundary (daemon API, SDK, journal, agent tools) are
// serialized with a category, a stable code, and a retryability hint.
// Applications must never have to parse English prose to branch on errors.
// ---------------------------------------------------------------------------

export type ErrorCategory =
  | 'CONFIG'
  | 'VALIDATION'
  | 'TRANSPORT'
  | 'PROTOCOL'
  | 'DEVICE'
  | 'CAPABILITY'
  | 'POLICY'
  | 'SAFETY'
  | 'LEASE'
  | 'OPERATION'
  | 'TIMEOUT'
  | 'AUTH'
  | 'MODULE'
  | 'GENERATOR'
  | 'UNSUPPORTED';

const RETRYABLE_CODES = new Set([
  'TRANSPORT_DISCONNECTED',
  'TRANSPORT_TIMEOUT',
  'DEVICE_BUSY',
  'LEASE_EXPIRED',
  'OPERATION_TIMEOUT',
  'TRANSPORT_RECONNECTING',
]);

/** Stable, wire-level error envelope. */
export interface StructuredError {
  code: string;
  category: ErrorCategory;
  message: string;
  retryable: boolean;
  device?: string;
  capability?: string;
  operation?: string;
  details?: Record<string, unknown>;
}

export class PinoutStructuredError extends PinoutError {
  readonly category: ErrorCategory;
  readonly retryable: boolean;
  readonly device: string | undefined;
  readonly capability: string | undefined;
  readonly operation: string | undefined;
  readonly details: Record<string, unknown>;

  constructor(
    code: string,
    category: ErrorCategory,
    message: string,
    options: {
      retryable?: boolean;
      device?: string;
      capability?: string;
      operation?: string;
      details?: Record<string, unknown>;
      cause?: unknown;
    } = {},
  ) {
    super(code, message, { cause: options.cause });
    this.category = category;
    this.retryable = options.retryable ?? RETRYABLE_CODES.has(code);
    this.device = options.device;
    this.capability = options.capability;
    this.operation = options.operation;
    this.details = options.details ?? {};
  }

  toJSON(): StructuredError {
    return {
      code: this.code,
      category: this.category,
      message: this.message,
      retryable: this.retryable,
      ...(this.device ? { device: this.device } : {}),
      ...(this.capability ? { capability: this.capability } : {}),
      ...(this.operation ? { operation: this.operation } : {}),
      ...(Object.keys(this.details).length > 0 ? { details: this.details } : {}),
    };
  }
}

/** Normalize any thrown value into a `StructuredError`. */
export function toStructuredError(
  error: unknown,
  context: { device?: string; capability?: string; operation?: string } = {},
): StructuredError {
  if (error instanceof PinoutStructuredError) {
    return error.toJSON();
  }
  if (error instanceof PinoutError) {
    const category = classifyCode(error.code);
    return {
      code: error.code,
      category,
      message: error.message,
      retryable: RETRYABLE_CODES.has(error.code),
      ...(context.device ? { device: context.device } : {}),
      ...(context.capability ? { capability: context.capability } : {}),
      ...(context.operation ? { operation: context.operation } : {}),
    };
  }
  if (error instanceof Error) {
    return {
      code: 'INTERNAL_ERROR',
      category: 'DEVICE',
      message: error.message,
      retryable: false,
      ...(context.device ? { device: context.device } : {}),
    };
  }
  return {
    code: 'INTERNAL_ERROR',
    category: 'DEVICE',
    message: String(error),
    retryable: false,
  };
}

function classifyCode(code: string): ErrorCategory {
  if (code.startsWith('POLICY_')) return 'POLICY';
  if (code.startsWith('SAFETY_')) return 'SAFETY';
  if (code.startsWith('LEASE_')) return 'LEASE';
  if (code.startsWith('MODULE_')) return 'MODULE';
  if (code.startsWith('GENERATOR_')) return 'GENERATOR';
  if (code.startsWith('TRANSPORT_')) return 'TRANSPORT';
  if (code.startsWith('CONFIG_')) return 'CONFIG';
  if (code.startsWith('AUTH_')) return 'AUTH';
  switch (code) {
    case 'VALIDATION_ERROR':
      return 'VALIDATION';
    case 'UNSUPPORTED_CAPABILITY':
      return 'UNSUPPORTED';
    case 'PROTOCOL_ERROR':
      return 'PROTOCOL';
    case 'TIMEOUT':
    case 'OPERATION_TIMEOUT':
      return 'TIMEOUT';
    case 'DISCONNECTED':
    case 'TRANSPORT_ERROR':
      return 'TRANSPORT';
    case 'ABORTED':
      return 'OPERATION';
    default:
      return 'DEVICE';
  }
}

export { RETRYABLE_CODES };
