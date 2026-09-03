export class MqttError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(code: string, message: string, retryable = false) {
    super(message);
    this.name = 'MqttError';
    this.code = code;
    this.retryable = retryable;
  }
}
