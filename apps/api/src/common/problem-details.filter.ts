import { Catch, HttpException, HttpStatus, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import { AppError, type ProblemDetails } from '@smart-hr/shared';
import type { Request, Response } from 'express';
import type { Logger } from 'pino';

const STATUS_CODES: Record<number, string> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  405: 'METHOD_NOT_ALLOWED',
  409: 'CONFLICT',
  413: 'PAYLOAD_TOO_LARGE',
  415: 'UNSUPPORTED_MEDIA_TYPE',
  422: 'UNPROCESSABLE',
  429: 'RATE_LIMITED',
};

function titleFor(status: number): string {
  if (status >= 500) return 'Internal server error';
  const words = (STATUS_CODES[status] ?? 'ERROR').replaceAll('_', ' ').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Maps every error to RFC 9457 problem details. Unexpected errors never expose internals to the client. */
export function toProblem(error: unknown, instance: string, requestId?: string): ProblemDetails {
  const base = { instance, ...(requestId ? { requestId } : {}) };

  if (error instanceof AppError) {
    return {
      type: 'about:blank',
      title: titleFor(error.status),
      status: error.status,
      code: error.code,
      detail: error.message,
      ...(error.details ? { errors: error.details } : {}),
      ...base,
    };
  }

  if (error instanceof HttpException) {
    const status = error.getStatus();
    const body = error.getResponse();
    const message = typeof body === 'object' && body !== null && 'message' in body ? body.message : body;
    const detail = Array.isArray(message) ? message.join('; ') : String(message);
    return {
      type: 'about:blank',
      title: titleFor(status),
      status,
      code: STATUS_CODES[status] ?? (status >= 500 ? 'INTERNAL_ERROR' : 'ERROR'),
      ...(status < 500 ? { detail } : {}),
      ...base,
    };
  }

  return {
    type: 'about:blank',
    title: titleFor(HttpStatus.INTERNAL_SERVER_ERROR),
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    code: 'INTERNAL_ERROR',
    ...base,
  };
}

@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  constructor(private readonly logger: Logger) {}

  catch(error: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const req = http.getRequest<Request & { id?: string }>();
    const res = http.getResponse<Response>();
    const problem = toProblem(error, req.originalUrl, req.id);

    if (problem.status >= 500) {
      this.logger.error({ err: error, requestId: req.id }, 'unhandled error');
    }

    res.status(problem.status).type('application/problem+json').json(problem);
  }
}
