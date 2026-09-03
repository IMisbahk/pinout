/**
 * Error taxonomy for the SCPI layer. These are self-contained (no runtime
 * dependency on @pinout/core) so the package can be reused in minimal setups.
 */
export class ScpiError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
  }
}

/** The command text could not be parsed as SCPI. */
export class ScpiParseError extends ScpiError {
  constructor(message: string) {
    super('SCPI_PARSE_ERROR', message);
  }
}

/** The call itself is invalid (bad channel number, query sent via command(), ...). */
export class ScpiUsageError extends ScpiError {
  constructor(message: string) {
    super('SCPI_USAGE', message);
  }
}

/** A query timed out waiting for a response line. */
export class ScpiTimeoutError extends ScpiError {
  constructor(message: string) {
    super('SCPI_TIMEOUT', message);
  }
}

/** The transport closed (or was closed) while requests were outstanding. */
export class ScpiClosedError extends ScpiError {
  constructor(message = 'The SCPI transport is closed.') {
    super('SCPI_CLOSED', message);
  }
}

/** A response line could not be interpreted (malformed *IDN?, non-numeric measurement, ...). */
export class ScpiResponseError extends ScpiError {
  constructor(message: string) {
    super('SCPI_RESPONSE', message);
  }
}

/**
 * `raw()` was called on an instrument without `{ allowRaw: true }`.
 * Raw access is deliberately opt-in so accidental vendor-specific coupling shows up loudly.
 */
export class ScpiRawDisabledError extends ScpiError {
  constructor(
    message = 'raw() is disabled. Construct the instrument with { allowRaw: true } to opt in.',
  ) {
    super('SCPI_RAW_DISABLED', message);
  }
}
