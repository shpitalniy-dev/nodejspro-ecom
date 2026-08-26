import { HttpException } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

import { toProblem } from '../filters/problem.ts';

interface ValidatorIssue {
  path?: string;
  message?: string;
}

interface ValidatorError extends Error {
  status?: number;
  errors?: ValidatorIssue[];
}

export function validationErrorHandler(
  err: ValidatorError,
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!err.status || !err.errors) {
    next(err);

    return;
  }

  const grouped = new Map<string, string[]>();

  for (const issue of err.errors) {
    const field = issue.path ?? 'request';
    const constraints = grouped.get(field) ?? [];
    constraints.push(issue.message ?? 'is invalid');
    grouped.set(field, constraints);
  }

  const exception = new HttpException(
    {
      title: 'Validation failed',
      detail: err.message,
      errors: Array.from(grouped, ([field, constraints]) => ({
        field,
        constraints,
      })),
    },
    err.status,
  );

  const problem = toProblem(exception, req);
  res.status(problem.status).type('application/problem+json').json(problem);
}
