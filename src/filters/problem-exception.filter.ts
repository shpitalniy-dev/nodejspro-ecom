import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import { Catch, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import type { Request, Response } from 'express';

import { LoggerService } from '../services/observability/logger.service.ts';

import { toHttpExceptionFromValidatorError } from './openapi-validation-error.ts';
import { toProblem } from './problem.ts';

@Injectable()
@Catch()
export class ProblemExceptionFilter implements ExceptionFilter {
  constructor(private readonly logger: LoggerService) {}

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

    // The original exception, not httpException — the synthesized fallback
    // above only ever says "An unexpected error occurred," never the real
    // message/stack. Client-facing responses stay sanitized; this is the
    // only place the real error is ever visible.
    if (problem.status >= 500) {
      this.logger.logError(exception);
    }

    res.status(problem.status).type('application/problem+json').json(problem);
  }
}
