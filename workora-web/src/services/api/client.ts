import { config } from '@/config';
import { useSessionStore } from '@/features/auth/session.store';

/** Error carrying the API's standard `{ code, message, details }` payload. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export interface Envelope<T> {
  data: T;
  meta: Record<string, any>;
}

type Query = Record<string, string | number | boolean | null | undefined>;

async function request<T>(method: string, path: string, opts: { body?: unknown; query?: Query } = {}): Promise<Envelope<T>> {
  const url = new URL(config.apiBase + path, window.location.origin);
  for (const [k, v] of Object.entries(opts.query ?? {})) if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));

  const token = useSessionStore.getState().session?.token;
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';

  let res: Response;
  try {
    res = await fetch(url, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'Could not reach the server. Check your connection.');
  }

  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.success) {
    const err = json?.error ?? { code: `HTTP_${res.status}`, message: res.statusText || 'Request failed' };
    if (res.status === 401 && token) useSessionStore.getState().signOut();
    // The workspace requires 2FA and this account hasn't set it up: the app shows the setup gate.
    if (res.status === 403 && err.code === 'MFA_SETUP_REQUIRED') {
      const sec = useSessionStore.getState().session?.security;
      if (sec && !sec.mfaSetupRequired) useSessionStore.getState().update({ security: { ...sec, mfaSetupRequired: true } });
    }
    throw new ApiError(res.status, err.code, err.message, err.details);
  }
  return { data: json.data as T, meta: json.meta ?? {} };
}

/** Thin REST client for /api/v1. Methods resolve to `data`; use `.raw` for `meta` too. */
export const api = {
  get: async <T>(path: string, query?: Query) => (await request<T>('GET', path, { query })).data,
  post: async <T>(path: string, body?: unknown) => (await request<T>('POST', path, { body: body ?? {} })).data,
  patch: async <T>(path: string, body: unknown) => (await request<T>('PATCH', path, { body })).data,
  delete: async <T>(path: string) => (await request<T>('DELETE', path)).data,
  raw: request,
};

export const errorMessage = (e: unknown) => (e instanceof ApiError || e instanceof Error ? e.message : 'Something went wrong');
