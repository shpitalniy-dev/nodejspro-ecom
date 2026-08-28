import { HttpException } from '@nestjs/common';

interface ValidatorIssue {
  path?: string;
  message?: string;
}

interface ValidatorError {
  status: number;
  message?: string;
  errors: ValidatorIssue[];
}

function isValidatorError(err: unknown): err is ValidatorError {
  return (
    typeof err === 'object' &&
    err !== null &&
    typeof (err as { status?: unknown }).status === 'number' &&
    Array.isArray((err as { errors?: unknown }).errors)
  );
}

export function toHttpExceptionFromValidatorError(
  err: unknown,
): HttpException | undefined {
  if (!isValidatorError(err)) {
    return undefined;
  }

  const grouped = new Map<string, string[]>();

  for (const issue of err.errors) {
    const field = issue.path ?? 'request';
    const constraints = grouped.get(field) ?? [];
    constraints.push(issue.message ?? 'is invalid');
    grouped.set(field, constraints);
  }

  return new HttpException(
    {
      title: 'Validation failed',
      detail:
        err.message ??
        'Request or response did not match the OpenAPI contract.',
      errors: Array.from(grouped, ([field, constraints]) => ({
        field,
        constraints,
      })),
    },
    err.status,
  );
}
