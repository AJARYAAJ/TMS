import { ValidationError, ValidationPipe } from '@nestjs/common';
import { ApiException } from './api-exception';

function flatten(errors: ValidationError[], parent = ''): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const e of errors) {
    const path = parent ? `${parent}.${e.property}` : e.property;
    if (e.constraints) out[path] = Object.values(e.constraints);
    if (e.children?.length) Object.assign(out, flatten(e.children, path));
  }
  return out;
}

export const validationPipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  exceptionFactory: (errors) => ApiException.badRequest('VALIDATION_ERROR', 'Request validation failed', flatten(errors)),
});
