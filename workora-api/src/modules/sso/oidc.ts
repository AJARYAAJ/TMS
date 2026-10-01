import { createHash, createPublicKey, JsonWebKey, randomBytes, verify as verifySignature } from 'crypto';

/** Minimal, dependency-free OpenID Connect relying party: discovery, PKCE, ID token verification. */

export interface Discovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
}

export class OidcError extends Error {}

const TIMEOUT_MS = 8000;
const cache = new Map<string, { at: number; value: unknown }>();
const TTL_MS = 10 * 60_000;

async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS), redirect: 'error' });
  const text = await res.text();
  let body: any;
  try {
    body = JSON.parse(text);
  } catch {
    throw new OidcError(`${new URL(url).host} returned ${res.status} (not JSON)`);
  }
  if (!res.ok) throw new OidcError(body?.error_description ?? body?.error ?? `${new URL(url).host} returned ${res.status}`);
  return body as T;
}

async function cached<T>(key: string, load: () => Promise<T>, force = false): Promise<T> {
  const hit = cache.get(key);
  if (!force && hit && Date.now() - hit.at < TTL_MS) return hit.value as T;
  const value = await load();
  cache.set(key, { at: Date.now(), value });
  return value;
}

/** Issuer URLs must be https (http only when private addresses are allowed, i.e. development). */
export function assertIssuerUrl(issuer: string, allowInsecure: boolean) {
  let u: URL;
  try {
    u = new URL(issuer);
  } catch {
    throw new OidcError('Issuer must be a URL, e.g. https://your-org.okta.com');
  }
  if (u.protocol !== 'https:' && !(allowInsecure && u.protocol === 'http:')) throw new OidcError('Issuer must use https');
  return issuer.replace(/\/$/, '');
}

export async function discover(issuer: string, force = false): Promise<Discovery> {
  return cached(`disc:${issuer}`, async () => {
    const d = await getJson<Discovery>(`${issuer}/.well-known/openid-configuration`);
    if (!d.authorization_endpoint || !d.token_endpoint || !d.jwks_uri) throw new OidcError('Discovery document is missing endpoints');
    // The provider must claim the issuer it was configured with (prevents mix-up attacks).
    if (d.issuer.replace(/\/$/, '') !== issuer) throw new OidcError(`Issuer mismatch: provider says ${d.issuer}`);
    return d;
  }, force);
}

async function jwks(uri: string, force = false) {
  return cached(`jwks:${uri}`, () => getJson<{ keys: (JsonWebKey & { kid?: string; alg?: string })[] }>(uri), force);
}

export const b64url = (buf: Buffer) => buf.toString('base64url');
export const randomToken = (bytes = 32) => b64url(randomBytes(bytes));
export const pkceChallenge = (verifier: string) => b64url(createHash('sha256').update(verifier).digest());

const ALGS: Record<string, { hash: string; dsa?: boolean }> = {
  RS256: { hash: 'sha256' },
  RS384: { hash: 'sha384' },
  RS512: { hash: 'sha512' },
  ES256: { hash: 'sha256', dsa: true },
  ES384: { hash: 'sha384', dsa: true },
};

export interface IdClaims {
  iss: string;
  sub: string;
  aud: string | string[];
  exp: number;
  iat: number;
  nonce?: string;
  email?: string;
  email_verified?: boolean | string;
  name?: string;
  preferred_username?: string;
}

/** Verifies signature (via JWKS, refreshing once on an unknown key id), issuer, audience, expiry and nonce. */
export async function verifyIdToken(idToken: string, d: Discovery, clientId: string, nonce: string, now = Date.now()): Promise<IdClaims> {
  const parts = idToken.split('.');
  if (parts.length !== 3) throw new OidcError('Malformed ID token');
  const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
  const alg = ALGS[header.alg];
  if (!alg) throw new OidcError(`Unsupported ID token algorithm ${header.alg}`);
  let set = await jwks(d.jwks_uri);
  let jwk = set.keys.find((k) => k.kid === header.kid) ?? (set.keys.length === 1 && !header.kid ? set.keys[0] : undefined);
  if (!jwk) {
    set = await jwks(d.jwks_uri, true);
    jwk = set.keys.find((k) => k.kid === header.kid);
  }
  if (!jwk) throw new OidcError('ID token signed with an unknown key');
  const ok = verifySignature(alg.hash, Buffer.from(`${parts[0]}.${parts[1]}`), { key: createPublicKey({ key: jwk, format: 'jwk' }), ...(alg.dsa ? { dsaEncoding: 'ieee-p1363' as const } : {}) }, Buffer.from(parts[2], 'base64url'));
  if (!ok) throw new OidcError('ID token signature is invalid');
  const c = JSON.parse(Buffer.from(parts[1], 'base64url').toString()) as IdClaims;
  const skew = 120;
  const t = Math.floor(now / 1000);
  if (c.iss.replace(/\/$/, '') !== d.issuer.replace(/\/$/, '')) throw new OidcError('ID token issuer mismatch');
  if (!(Array.isArray(c.aud) ? c.aud : [c.aud]).includes(clientId)) throw new OidcError('ID token audience mismatch');
  if (typeof c.exp !== 'number' || c.exp + skew < t) throw new OidcError('ID token expired');
  if (typeof c.iat === 'number' && c.iat - skew > t) throw new OidcError('ID token issued in the future');
  if (c.nonce !== nonce) throw new OidcError('ID token nonce mismatch');
  return c;
}

export async function exchangeCode(d: Discovery, p: { code: string; redirectUri: string; clientId: string; clientSecret: string; verifier: string }) {
  const body = new URLSearchParams({ grant_type: 'authorization_code', code: p.code, redirect_uri: p.redirectUri, code_verifier: p.verifier, client_id: p.clientId, client_secret: p.clientSecret });
  const tokens = await getJson<{ id_token?: string }>(d.token_endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body,
  });
  if (!tokens.id_token) throw new OidcError('Provider did not return an ID token (is the "openid" scope allowed?)');
  return tokens.id_token;
}
