export class GrblError extends Error {
  readonly code: string;
  readonly grblErrorCode: number;

  constructor(grblErrorCode: number, message: string) {
    super(message);
    this.name = 'GrblError';
    this.code = 'GRBL_ERROR';
    this.grblErrorCode = grblErrorCode;
  }
}

export class GrblStatusError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'GrblStatusError';
    this.code = code;
  }
}
