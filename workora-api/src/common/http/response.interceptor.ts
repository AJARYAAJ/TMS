import { CallHandler, ExecutionContext, Injectable, NestInterceptor, StreamableFile } from '@nestjs/common';
import { map, Observable } from 'rxjs';
import { ApiResult, RawJson } from './api-response';

@Injectable()
export class ResponseEnvelopeInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    return next.handle().pipe(
      map((body) => {
        if (body instanceof StreamableFile) return body;
        if (body instanceof RawJson) return body.body;
        if (body instanceof ApiResult) return { success: true, data: body.data, meta: body.meta };
        return { success: true, data: body ?? null, meta: {} };
      }),
    );
  }
}
