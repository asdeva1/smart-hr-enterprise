/**
 * RFC 9457 problem details, the single error shape every API response uses.
 * `code` is a stable machine-readable identifier clients can switch on.
 */
export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  code: string;
  detail?: string;
  instance?: string;
  requestId?: string;
  errors?: { path: string; message: string }[];
}

export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
    public readonly details?: { path: string; message: string }[],
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string) {
    super('NOT_FOUND', `${resource} was not found`, 404);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'You do not have permission to do this') {
    super('FORBIDDEN', message, 403);
  }
}
