import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import type { Response } from 'express';
import { QueryFailedError } from 'typeorm';
import { ApiException } from './api-exception';
import { ApiFailure } from './api-response';

const STATUS_CODES: Record<number, string> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  405: 'METHOD_NOT_ALLOWED',
  409: 'CONFLICT',
  413: 'PAYLOAD_TOO_LARGE',
  429: 'RATE_LIMITED',
};

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('ApiExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost) {
    if (host.getType() !== 'http') throw exception;
    const res = host.switchToHttp().getResponse<Response>();
    const [status, body] = this.toFailure(exception);
    if (status >= 500) this.logger.error(exception instanceof Error ? exception.stack : exception);
    if (!res.headersSent) res.status(status).json(body);
  }

  private toFailure(exception: unknown): [number, ApiFailure] {
    if (exception instanceof ApiException) {
      const details = exception.details === undefined ? {} : { details: exception.details };
      return [exception.getStatus(), { success: false, error: { code: exception.code, message: exception.message, ...details } }];
    }
    if (exception instanceof ThrottlerException) {
      return [429, { success: false, error: { code: 'RATE_LIMITED', message: 'Too many requests. Please slow down.' } }];
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const response = exception.getResponse();
      const message =
        typeof response === 'object' && response && 'message' in response
          ? String(Array.isArray((response as any).message) ? (response as any).message.join('; ') : (response as any).message)
          : exception.message;
      return [status, { success: false, error: { code: STATUS_CODES[status] ?? `HTTP_${status}`, message } }];
    }
    if (exception instanceof QueryFailedError && (exception as any).driverError?.code === '23505') {
      return [HttpStatus.CONFLICT, { success: false, error: { code: 'CONFLICT', message: 'A record with the same unique value already exists' } }];
    }
    return [HttpStatus.INTERNAL_SERVER_ERROR, { success: false, error: { code: 'INTERNAL_ERROR', message: 'Something went wrong' } }];
  }
}
