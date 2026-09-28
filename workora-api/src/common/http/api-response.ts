/**
 * Every endpoint responds with the same envelope:
 *   success: { success: true, data, meta }
 *   error:   { success: false, error: { code, message, details? } }
 */
export interface ApiSuccess<T> {
  success: true;
  data: T;
  meta: Record<string, unknown>;
}

export interface ApiFailure {
  success: false;
  error: { code: string; message: string; details?: unknown };
}

/** Return this from a controller to attach `meta` (e.g. pagination) to the envelope. */
export class ApiResult<T> {
  constructor(
    readonly data: T,
    readonly meta: Record<string, unknown> = {},
  ) {}
}

export function paginated<T>(items: T[], page: number, size: number, total: number): ApiResult<T[]> {
  return new ApiResult(items, { page, size, total, totalPages: Math.ceil(total / size) });
}

/** Return this to send a body verbatim, without the API envelope (e.g. replies to Slack). */
export class RawJson<T = unknown> {
  constructor(readonly body: T) {}
}
