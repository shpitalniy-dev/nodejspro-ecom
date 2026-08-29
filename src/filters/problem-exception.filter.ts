import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import { Catch, HttpException, HttpStatus } from '@nestjs/common';
import type { Request, Response } from 'express';

import { toHttpExceptionFromValidatorError } from './openapi-validation-error.ts';
import { toProblem } from './problem.ts';

@Catch()
export class ProblemExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request>();
    const res = ctx.getResponse<Response>();

    let httpException: HttpException | undefined =
      exception instanceof HttpException
        ? exception
        : toHttpExceptionFromValidatorError(exception);

    if (!httpException) {
      httpException = new HttpException(
        {
          title: 'Internal Server Error',
          detail: 'An unexpected error occurred.',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    const problem = toProblem(httpException, req);

    res.status(problem.status).type('application/problem+json').json(problem);
  }
}
