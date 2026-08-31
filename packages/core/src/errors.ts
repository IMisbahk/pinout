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

export class DeviceError extends PinoutError {
  readonly details: unknown;

  constructor(code: string, message: string, details?: unknown) {
    super(code, message);
    this.details = details;
  }
}
