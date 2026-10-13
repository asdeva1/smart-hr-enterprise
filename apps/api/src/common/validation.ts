import { StandardSchemaValidationPipe } from '@nestjs/common';
import { AppError } from '@smart-hr/shared';

/**
 * Global request validation. Handlers declare a Zod schema on the parameter, for example
 * `@Body({ schema: createEmployeeSchema }) body: CreateEmployee`; failures become problem details
 * with one entry per invalid field.
 */
export function createValidationPipe(): StandardSchemaValidationPipe {
  return new StandardSchemaValidationPipe({
    transform: true,
    exceptionFactory: (issues) =>
      new AppError(
        'VALIDATION_FAILED',
        'The request contains invalid fields',
        400,
        issues.map((issue) => ({
          path: (issue.path ?? [])
            .map((segment) => (typeof segment === 'object' ? String(segment.key) : String(segment)))
            .join('.'),
          message: issue.message,
        })),
      ),
  });
}
