import type { NextFunction, Request, Response } from 'express';

import { toHttpExceptionFromValidatorError } from '../filters/openapi-validation-error.ts';
import { toProblem } from '../filters/problem.ts';

export function validationErrorHandler(
  err: unknown,
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const exception = toHttpExceptionFromValidatorError(err);

  if (!exception) {
    next(err);

    return;
  }

  const problem = toProblem(exception, req);
  res.status(problem.status).type('application/problem+json').json(problem);
}
