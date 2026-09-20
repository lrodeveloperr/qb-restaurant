export class AppError extends Error {
  constructor(code, message, details = {}, cause) {
    super(message, cause ? { cause } : undefined);
    this.name = 'AppError';
    this.code = code;
    this.details = details;
  }
}

export class UnknownWriteOutcomeError extends AppError {
  constructor(message = 'The external write outcome is unknown.', details = {}) {
    super('OUTCOME_UNKNOWN', message, details);
    this.name = 'UnknownWriteOutcomeError';
  }
}

export function invariant(condition, code, message, details = {}) {
  if (!condition) throw new AppError(code, message, details);
}

export function toSafeError(error) {
  if (error instanceof AppError) {
    return { code: error.code, message: error.message, details: error.details };
  }
  return { code: 'UNEXPECTED_ERROR', message: 'An unexpected error occurred.', details: {} };
}
