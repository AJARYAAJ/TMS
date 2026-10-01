import { createHash, createSign, generateKeyPairSync, randomBytes } from 'crypto';
import { createServer, Server } from 'http';
import { AddressInfo } from 'net';

export interface MockUser {
  sub: string;
  email: string;
  name?: string;
  email_verified?: boolean;
}

/**
 * A tiny OpenID Connect provider for tests: discovery, JWKS, an authorize endpoint that
 * "signs in" `user` immediately, and a token endpoint that checks the client secret and PKCE.
 */
export async function startMockIdp(opts: { clientId: string; clientSecret: string }) {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const kid = 'test-key-1';
  const other = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const codes = new Map<string, { nonce: string; challenge: string; redirectUri: string; user: MockUser }>();
  const state = {
    user: { sub: 'idp-user-1', email: 'sam@acme.test', name: 'Sam SSO', email_verified: true } as MockUser,
    /** Break the next ID token on purpose. */
    tamper: null as null | 'aud' | 'nonce' | 'signature' | 'expired' | 'issuer',
  };
  let issuer = '';

  const sign = (claims: Record<string, unknown>, key = privateKey) => {
    const enc = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const head = enc({ alg: 'RS256', typ: 'JWT', kid });
    const body = enc(claims);
    const sig = createSign('RSA-SHA256').update(`${head}.${body}`).sign(key).toString('base64url');
    return `${head}.${body}.${sig}`;
  };

  const server: Server = createServer((req, res) => {
    const url = new URL(req.url!, issuer);
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (url.pathname === '/.well-known/openid-configuration') {
      return json(200, { issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, jwks_uri: `${issuer}/jwks` });
    }
    if (url.pathname === '/jwks') return json(200, { keys: [{ ...publicKey.export({ format: 'jwk' }), kid, alg: 'RS256', use: 'sig' }] });
    if (url.pathname === '/authorize') {
      const p = url.searchParams;
      if (p.get('client_id') !== opts.clientId || p.get('response_type') !== 'code' || p.get('code_challenge_method') !== 'S256') return json(400, { error: 'invalid_request' });
      const code = randomBytes(12).toString('hex');
      codes.set(code, { nonce: p.get('nonce')!, challenge: p.get('code_challenge')!, redirectUri: p.get('redirect_uri')!, user: { ...state.user } });
      const back = new URL(p.get('redirect_uri')!);
      back.searchParams.set('code', code);
      back.searchParams.set('state', p.get('state')!);
      res.writeHead(302, { Location: back.toString() });
      return res.end();
    }
    if (url.pathname === '/token' && req.method === 'POST') {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        const f = new URLSearchParams(raw);
        const entry = codes.get(f.get('code') ?? '');
        if (!entry) return json(400, { error: 'invalid_grant', error_description: 'unknown code' });
        codes.delete(f.get('code')!);
        if (f.get('client_id') !== opts.clientId || f.get('client_secret') !== opts.clientSecret) return json(401, { error: 'invalid_client' });
        if (f.get('redirect_uri') !== entry.redirectUri) return json(400, { error: 'invalid_grant', error_description: 'redirect_uri mismatch' });
        const challenge = createHash('sha256').update(f.get('code_verifier') ?? '').digest('base64url');
        if (challenge !== entry.challenge) return json(400, { error: 'invalid_grant', error_description: 'PKCE verification failed' });
        const now = Math.floor(Date.now() / 1000);
        const t = state.tamper;
        state.tamper = null;
        const claims = {
          iss: t === 'issuer' ? 'https://evil.test' : issuer,
          aud: t === 'aud' ? 'someone-else' : opts.clientId,
          sub: entry.user.sub,
          email: entry.user.email,
          email_verified: entry.user.email_verified ?? true,
          name: entry.user.name,
          nonce: t === 'nonce' ? 'wrong-nonce' : entry.nonce,
          iat: now,
          exp: t === 'expired' ? now - 3600 : now + 300,
        };
        json(200, { access_token: 'at', token_type: 'Bearer', id_token: sign(claims, t === 'signature' ? other.privateKey : privateKey) });
      });
      return;
    }
    json(404, { error: 'not_found' });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  issuer = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { issuer, state, close: () => new Promise<void>((r) => server.close(() => r())) };
}
