import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AppError } from '@smart-hr/shared';
import { describe, expect, it } from 'vitest';
import { toProblem } from './problem-details.filter.js';

describe('toProblem', () => {
  it('keeps the code, message and field errors of an AppError', () => {
    const problem = toProblem(
      new AppError('VALIDATION_FAILED', 'Request is invalid', 400, [{ path: 'email', message: 'Required' }]),
      '/v1/things',
      'req-1',
    );
    expect(problem).toEqual({
      type: 'about:blank',
      title: 'Bad request',
      status: 400,
      code: 'VALIDATION_FAILED',
      detail: 'Request is invalid',
      errors: [{ path: 'email', message: 'Required' }],
      instance: '/v1/things',
      requestId: 'req-1',
    });
  });

  it('maps Nest HTTP exceptions to stable codes', () => {
    expect(toProblem(new NotFoundException('Missing'), '/x')).toMatchObject({
      status: 404,
      code: 'NOT_FOUND',
      detail: 'Missing',
    });
    expect(toProblem(new BadRequestException(['a is bad', 'b is bad']), '/x').detail).toBe(
      'a is bad; b is bad',
    );
  });

  it('never exposes the message of an unexpected error', () => {
    const problem = toProblem(new Error('connection to 10.0.3.7 refused for user app_rw'), '/x');
    expect(problem).toEqual({
      type: 'about:blank',
      title: 'Internal server error',
      status: 500,
      code: 'INTERNAL_ERROR',
      instance: '/x',
    });
    expect(JSON.stringify(problem)).not.toContain('10.0.3.7');
  });
});
