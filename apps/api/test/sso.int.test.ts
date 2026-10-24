/**
 * Single sign-on through a customer's OpenID Connect provider, against a small provider run inside the test.
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { exportJWK, generateKeyPair, SignJWT, type CryptoKey, type JWK } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isPrivateAddress } from '../src/sso/safe-fetch.js';
import { safeNext } from '../src/sso/sso.service.js';
import { Browser, Fixtures, ownerClient, startApp, testEnv } from './helpers.js';

const db = ownerClient();
const fx = new Fixtures(db);
const CLIENT_ID = 'smarthr-test';
const CLIENT_SECRET = 'a-very-secret-value-for-the-test';

let app: NestExpressApplication;
let idp: Server;
let issuer = '';
let signing: { privateKey: CryptoKey; jwk: JWK };
let strangerKey: CryptoKey;
/** What the provider will put in its next ID token. */
let next: { email: string; verified?: boolean; sign?: 'good' | 'stranger'; aud?: string } = { email: '' };
let nonceSeen = '';
const tokenCalls: string[] = [];

let tenant: { id: string };
let otherTenant: { id: string };
let admin: Browser;
let adminEmail = '';
let memberEmail = '';
let memberPassword: Browser;
let outsiderEmail = '';
let operatorEmail = '';

async function startProvider() {
  signing = await (async () => {
    const pair = await generateKeyPair('RS256');
    const jwk = await exportJWK(pair.publicKey);
    return { privateKey: pair.privateKey, jwk: { ...jwk, kid: 'k1', alg: 'RS256', use: 'sig' } };
  })();
  strangerKey = (await generateKeyPair('RS256')).privateKey;
  idp = createServer((req, res) => {
    const url = new URL(req.url ?? '/', issuer);
    const json = (body: unknown) => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(body));
    };
    if (url.pathname === '/.well-known/openid-configuration') {
      return json({
        issuer,
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/token`,
        jwks_uri: `${issuer}/jwks`,
        token_endpoint_auth_methods_supported: ['client_secret_basic'],
      });
    }
    if (url.pathname === '/jwks') return json({ keys: [signing.jwk] });
    if (url.pathname === '/token' && req.method === 'POST') {
      let body = '';
      req.on('data', (c: Buffer) => (body += c.toString()));
      req.on('end', () => {
        tokenCalls.push(`${req.headers.authorization ?? ''}|${body}`);
        void new SignJWT({
          email: next.email,
          email_verified: next.verified ?? true,
          name: 'Test Person',
          nonce: nonceSeen,
        })
          .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
          .setIssuer(issuer)
          .setAudience(next.aud ?? CLIENT_ID)
          .setSubject('sub-123')
          .setIssuedAt()
          .setExpirationTime('5m')
          .sign(next.sign === 'stranger' ? strangerKey : signing.privateKey)
          .then((id_token) => json({ id_token, token_type: 'Bearer' }));
      });
      return;
    }
    res.statusCode = 404;
    res.end();
  });
  await new Promise<void>((r) => idp.listen(0, '127.0.0.1', r));
  issuer = `http://127.0.0.1:${(idp.address() as AddressInfo).port}`;
}

beforeAll(async () => {
  await startProvider();
  app = await startApp(testEnv({ SSO_ALLOW_PRIVATE_NETWORK: 'true', APP_PUBLIC_URL: 'http://localhost:3000' }));
  tenant = await fx.tenant('Sso');
  otherTenant = await fx.tenant('Other');

  const a = await fx.user('sso-admin');
  adminEmail = a.email;
  await fx.member(tenant.id, a.id, true);
  const m = await fx.user('sso-member');
  memberEmail = m.email;
  const mm = await fx.member(tenant.id, m.id);
  await fx.assign(tenant.id, mm.id, await fx.systemRole(tenant.id, 'hr_admin'));
  await fx.member(otherTenant.id, m.id);
  const o = await fx.user('sso-outsider');
  outsiderEmail = o.email;
  const op = await fx.user('sso-operator', { platformAdmin: true });
  operatorEmail = op.email;
  await fx.member(tenant.id, op.id);

  admin = new Browser(app);
  expect((await admin.login(adminEmail)).status).toBe(200);
  memberPassword = new Browser(app);
  expect((await memberPassword.login(memberEmail)).status).toBe(200);
});

afterAll(async () => {
  await app?.close();
  await new Promise((r) => idp?.close(r));
  await fx.cleanup();
  await db.$disconnect();
});

const settings = (over: Record<string, unknown> = {}) => ({
  issuer,
  clientId: CLIENT_ID,
  clientSecret: CLIENT_SECRET,
  allowedDomains: ['test.local'],
  requireVerifiedEmail: true,
  enabled: true,
  enforced: false,
  ...over,
});

/** Runs a whole sign-in as a fresh browser: start, the provider's reply, then the callback. */
async function signIn(email: string, claims: Partial<typeof next> = {}, tamperState = false) {
  const browser = new Browser(app);
  const start = await browser.get(`/v1/sso/start?email=${encodeURIComponent(email)}`);
  const location = new URL(start.headers.location as string);
  // Refused up front: the browser is sent back to the sign-in page with a reason.
  if (location.pathname === '/login') return { browser, start, callback: start };
  nonceSeen = location.searchParams.get('nonce') ?? '';
  next = { email, ...claims };
  const state = tamperState ? 'wrong-state' : (location.searchParams.get('state') ?? '');
  const callback = await browser.get(`/v1/sso/callback?code=abc&state=${state}`);
  return { browser, start, callback };
}

describe('pure helpers', () => {
  it('recognises private addresses', () => {
    for (const a of ['127.0.0.1', '10.0.0.5', '192.168.1.1', '172.20.0.1', '169.254.169.254', '::1', 'fd00::1', '::ffff:10.0.0.1']) {
      expect(isPrivateAddress(a), a).toBe(true);
    }
    for (const a of ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111']) expect(isPrivateAddress(a), a).toBe(false);
  });
  it('only returns to paths inside the app', () => {
    expect(safeNext('/leave')).toBe('/leave');
    for (const bad of ['//evil.com', 'https://evil.com', '/\\evil', undefined, '']) expect(safeNext(bad as string)).toBe('/');
  });
});

describe('setting it up', () => {
  it('is for people who manage security, on a plan that includes it', async () => {
    expect((await memberPassword.get('/v1/sso/connection')).status).toBe(403);
    const res = await admin.get('/v1/sso/connection');
    expect(res.status).toBe(200);
    expect(res.body.connection).toBeNull();
    expect(res.body.redirectUri).toMatch(/\/v1\/sso\/callback$/);
  });

  it('needs a secret the first time, and a provider that answers', async () => {
    const { clientSecret: _s, ...noSecret } = settings();
    expect((await admin.send('put', '/v1/sso/connection', noSecret)).status).toBe(400);
    const badIssuer = await admin.send('put', '/v1/sso/connection', settings({ issuer: `${issuer}/nope` }));
    expect(badIssuer.status).toBe(400);
    const enforcedOff = await admin.send('put', '/v1/sso/connection', settings({ enabled: false, enforced: true }));
    expect(enforcedOff.status).toBe(400);
  });

  it('saves, hides the secret, and keeps it when left blank', async () => {
    const res = await admin.send('put', '/v1/sso/connection', settings());
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain(CLIENT_SECRET);
    expect(res.body.connection.hasSecret).toBe(true);
    const row = await db.ssoConnection.findUniqueOrThrow({ where: { tenantId: tenant.id } });
    expect(row.clientSecretSealed).not.toContain(CLIENT_SECRET);
    const { clientSecret: _s, ...noSecret } = settings();
    expect((await admin.send('put', '/v1/sso/connection', noSecret)).status).toBe(200);
    const after = await db.ssoConnection.findUniqueOrThrow({ where: { tenantId: tenant.id } });
    expect(after.clientSecretSealed).toBe(row.clientSecretSealed);
  });
});

describe('the sign-in page', () => {
  it('offers single sign-on only to people it applies to', async () => {
    const yes = await new Browser(app).get(`/v1/sso/discover?email=${encodeURIComponent(memberEmail)}`);
    expect(yes.body).toMatchObject({ sso: true, enforced: false });
    for (const email of [outsiderEmail, operatorEmail, 'nobody@test.local', 'x@other-domain.org']) {
      const no = await new Browser(app).get(`/v1/sso/discover?email=${encodeURIComponent(email)}`);
      expect(no.body).toEqual({ sso: false });
    }
  });
});

describe('signing in', () => {
  it('signs a member in, bound to that organisation', async () => {
    const { browser, start, callback } = await signIn(memberEmail);
    expect(new URL(start.headers.location as string).searchParams.get('code_challenge_method')).toBe('S256');
    expect(callback.status).toBe(302);
    expect(callback.headers.location).toBe('http://localhost:3000/');
    // The provider was sent the PKCE verifier and the client credentials.
    expect(tokenCalls.at(-1)).toContain('code_verifier=');
    expect(tokenCalls.at(-1)).toMatch(/^Basic /);

    const session = await browser.get('/v1/auth/session');
    expect(session.status).toBe(200);
    expect(session.body.activeTenant.id).toBe(tenant.id);
    // The same person belongs to another organisation, which this sign-in cannot reach.
    const ids = (session.body.memberships as { tenantId: string }[]).map((m) => m.tenantId);
    expect(ids).toEqual([tenant.id]);
    const sw = await browser.send('post', '/v1/auth/tenant', { tenantId: otherTenant.id });
    expect(sw.status).toBe(403);
    const row = await db.ssoConnection.findUniqueOrThrow({ where: { tenantId: tenant.id } });
    expect(row.lastLoginAt).not.toBeNull();
  });

  it('leaves sign-in details with the provider', async () => {
    const { browser } = await signIn(memberEmail);
    const res = await browser.send('post', '/v1/auth/mfa/totp/setup');
    expect(res.status).toBe(403);
    expect(res.body.code ?? res.body.error?.code).toBe('SSO_MANAGED');
  });

  it('turns away anything that does not check out', async () => {
    const reason = (r: { callback: { headers: Record<string, unknown> } }) =>
      new URL(String(r.callback.headers.location)).searchParams.get('sso_error');
    expect(reason(await signIn(memberEmail, {}, true))).toBe('expired');
    expect(reason(await signIn(memberEmail, { verified: false }))).toBe('unverified_email');
    expect(reason(await signIn(memberEmail, { sign: 'stranger' }))).toBe('provider');
    expect(reason(await signIn(memberEmail, { aud: 'someone-else' }))).toBe('provider');
    // The provider vouches for a different address than the one asked for, and that person is not a member.
    expect(reason(await signIn(memberEmail, { email: outsiderEmail }))).toBe('no_access');
    expect(reason(await signIn(memberEmail, { email: 'x@elsewhere.org' }))).toBe('wrong_domain');
    // Platform operators never use it.
    expect(reason(await signIn(operatorEmail))).toBe('unavailable');
  });

  it('refuses a callback without the cookie from the same browser', async () => {
    const first = await signIn(memberEmail);
    const state = new URL(first.start.headers.location as string).searchParams.get('state');
    const res = await new Browser(app).get(`/v1/sso/callback?code=abc&state=${state}`);
    expect(new URL(String(res.headers.location)).searchParams.get('sso_error')).toBe('expired');
  });

  it('does not sign in once switched off', async () => {
    await admin.send('put', '/v1/sso/connection', settings({ enabled: false }));
    const { callback } = await signIn(memberEmail);
    expect(new URL(String(callback.headers.location)).searchParams.get('sso_error')).toBe('unavailable');
    await admin.send('put', '/v1/sso/connection', settings());
  });
});

describe('requiring it', () => {
  it('stops members using a password, while administrators keep theirs', async () => {
    expect((await admin.send('put', '/v1/sso/connection', settings({ enforced: true }))).status).toBe(200);
    // The member's password sign-in no longer opens the organisation…
    const blocked = await memberPassword.get('/v1/sso/connection');
    expect(blocked.status).toBe(403);
    const employees = await memberPassword.send('post', '/v1/auth/tenant', { tenantId: tenant.id });
    expect(employees.status).toBe(200);
    const probe = await memberPassword.get('/v1/employees');
    expect(probe.status).toBe(403);
    expect(probe.body.code ?? probe.body.error?.code).toBe('SSO_REQUIRED');
    // …and the administrator still gets in.
    expect((await admin.get('/v1/sso/connection')).status).toBe(200);
    // Single sign-on itself still works for the member.
    const { browser, callback } = await signIn(memberEmail);
    expect(callback.headers.location, JSON.stringify(callback.headers)).toBe('http://localhost:3000/');
    const ok = await browser.get('/v1/employees');
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
  });
});
