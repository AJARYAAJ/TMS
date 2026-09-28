import { HttpException, HttpStatus } from '@nestjs/common';

export class ApiException extends HttpException {
  constructor(
    status: HttpStatus,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super({ code, message, details }, status);
  }

  static notFound(entity: string, message?: string) {
    return new ApiException(HttpStatus.NOT_FOUND, `${entity.toUpperCase()}_NOT_FOUND`, message ?? `${capitalize(entity)} does not exist`);
  }

  static badRequest(code: string, message: string, details?: unknown) {
    return new ApiException(HttpStatus.BAD_REQUEST, code, message, details);
  }

  static conflict(code: string, message: string) {
    return new ApiException(HttpStatus.CONFLICT, code, message);
  }

  static forbidden(message = 'You do not have permission to perform this action') {
    return new ApiException(HttpStatus.FORBIDDEN, 'FORBIDDEN', message);
  }

  static unauthorized(message = 'Authentication required') {
    return new ApiException(HttpStatus.UNAUTHORIZED, 'UNAUTHORIZED', message);
  }
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}
