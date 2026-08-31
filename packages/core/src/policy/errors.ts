import { PinoutError } from '../errors.js';

export class PolicyError extends PinoutError {
  readonly metadata: Record<string, unknown>;

  constructor(code: string, message: string, metadata: Record<string, unknown> = {}) {
    super(code, message);
    this.metadata = metadata;
  }
}

export class PolicyConstraintViolation extends PolicyError {
  constructor(message: string, metadata: Record<string, unknown> = {}) {
    super('POLICY_CONSTRAINT_VIOLATION', message, metadata);
  }
}

export class PolicyPreconditionFailed extends PolicyError {
  constructor(message: string, metadata: Record<string, unknown> = {}) {
    super('POLICY_PRECONDITION_FAILED', message, metadata);
  }
}

export class PolicyActionDenied extends PolicyError {
  constructor(message: string, metadata: Record<string, unknown> = {}) {
    super('POLICY_ACTION_DENIED', message, metadata);
  }
}
