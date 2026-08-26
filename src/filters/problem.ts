import type { HttpException } from '@nestjs/common';
import type { Request } from 'express';

export interface ProblemFieldError {
  field: string;
  constraints: string[];
}

export interface Problem {
  type: string;
  title: string;
  status: number;
  detail: string;
  instance: string;
  method: string;
  errors?: ProblemFieldError[];
}

interface ProblemResponsePayload {
  type?: string;
  title?: string;
  detail?: string;
  errors?: ProblemFieldError[];
}

export function toProblem(exception: HttpException, req: Request): Problem {
  const status = exception.getStatus();
  const response = exception.getResponse();
  const payload: ProblemResponsePayload =
    typeof response === 'object' && response !== null
      ? (response as ProblemResponsePayload)
      : {};

  return {
    type: payload.type ?? `/problems/${status}`,
    title: payload.title ?? exception.name,
    status,
    detail: payload.detail ?? exception.message,
    instance: req.originalUrl,
    method: req.method,
    ...(payload.errors ? { errors: payload.errors } : {}),
  };
}
