import { Inject, Injectable } from '@nestjs/common';
import { AppError } from '@smart-hr/shared';
import { createHash, randomBytes } from 'node:crypto';
import { createLocalJWKSet, jwtVerify, type JSONWebKeySet } from 'jose';
import type { ApiEnv } from '../config/env.js';
import { API_ENV } from '../infra/tokens.js';
import { safeFetch, UnsafeUrlError } from './safe-fetch.js';

export interface OidcMetadata {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  token_endpoint_auth_methods_supported?: string[];
}

export interface OidcIdentity {
  subject: string;
  email: string;
  emailVerified: boolean;
  name: string | null;
}

const CACHE_MS = 10 * 60_000;
const ALGORITHMS = ['RS256', 'RS384', 'RS512', 'PS256', 'ES256', 'ES384'];

class SsoProviderError extends AppError {
  constructor(message: string) {
    super('SSO_PROVIDER_ERROR', message, 502);
  }
}

const b64url = (buf: Buffer) => buf.toString('base64url');

/** Talks to an identity provider using the OpenID Connect authorisation-code flow with PKCE. */
@Injectable()
export class OidcService {
  private readonly metadata = new Map<string, { at: number; value: OidcMetadata }>();
  private readonly keys = new Map<string, { at: number; value: JSONWebKeySet }>();

  constructor(@Inject(API_ENV) private readonly env: ApiEnv) {}

  private get priv() {
    return this.env.SSO_ALLOW_PRIVATE_NETWORK;
  }

  private async fetchJson(url: string, init: Parameters<typeof safeFetch>[1] = {}): Promise<unknown> {
    try {
      const res = await safeFetch(url, { ...init, allowPrivateNetwork: this.priv });
      if (res.status < 200 || res.status >= 300) {
        throw new SsoProviderError(`The identity provider answered with an error (${res.status})`);
      }
      return JSON.parse(res.text);
    } catch (error) {
      if (error instanceof AppError) throw error;
      if (error instanceof UnsafeUrlError) throw new SsoProviderError(error.message);
      throw new SsoProviderError('The identity provider could not be reached or sent an unreadable answer');
    }
  }

  async discover(issuer: string, fresh = false): Promise<OidcMetadata> {
    const cached = this.metadata.get(issuer);
    if (!fresh && cached && Date.now() - cached.at < CACHE_MS) return cached.value;
    const doc = (await this.fetchJson(`${issuer}/.well-known/openid-configuration`)) as Partial<OidcMetadata>;
    // The document must describe the issuer we asked about, or a different provider could pose as it.
    if (doc.issuer !== issuer) throw new SsoProviderError('The provider’s issuer does not match the address given');
    for (const key of ['authorization_endpoint', 'token_endpoint', 'jwks_uri'] as const) {
      const value = doc[key];
      if (typeof value !== 'string') throw new SsoProviderError(`The provider’s settings are missing ${key}`);
      const url = new URL(value);
      if (url.protocol !== 'https:' && !(this.priv && url.protocol === 'http:')) {
        throw new SsoProviderError('The provider must use https');
      }
    }
    const value = doc as OidcMetadata;
    this.metadata.set(issuer, { at: Date.now(), value });
    return value;
  }

  newAttempt() {
    const verifier = b64url(randomBytes(32));
    return {
      state: b64url(randomBytes(24)),
      nonce: b64url(randomBytes(24)),
      verifier,
      challenge: b64url(createHash('sha256').update(verifier).digest()),
    };
  }

  authorizeUrl(
    meta: OidcMetadata,
    p: { clientId: string; redirectUri: string; state: string; nonce: string; challenge: string; loginHint: string },
  ): string {
    const url = new URL(meta.authorization_endpoint);
    url.search = new URLSearchParams({
      response_type: 'code',
      client_id: p.clientId,
      redirect_uri: p.redirectUri,
      scope: 'openid email profile',
      state: p.state,
      nonce: p.nonce,
      code_challenge: p.challenge,
      code_challenge_method: 'S256',
      login_hint: p.loginHint,
    }).toString();
    return url.toString();
  }

  /** Swaps the one-time code for an ID token and returns the verified person it describes. */
  async completeLogin(
    issuer: string,
    p: { clientId: string; clientSecret: string; redirectUri: string; code: string; verifier: string; nonce: string },
  ): Promise<OidcIdentity> {
    const meta = await this.discover(issuer);
    const form = new URLSearchParams({
      grant_type: 'authorization_code',
      code: p.code,
      redirect_uri: p.redirectUri,
      code_verifier: p.verifier,
    });
    const headers: Record<string, string> = { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' };
    const methods = meta.token_endpoint_auth_methods_supported;
    if (!methods || methods.includes('client_secret_basic')) {
      const enc = (v: string) => encodeURIComponent(v).replace(/%20/g, '+');
      headers.authorization = `Basic ${Buffer.from(`${enc(p.clientId)}:${enc(p.clientSecret)}`).toString('base64')}`;
    } else {
      form.set('client_id', p.clientId);
      form.set('client_secret', p.clientSecret);
    }
    const token = (await this.fetchJson(meta.token_endpoint, {
      method: 'POST',
      headers,
      body: form.toString(),
    })) as { id_token?: unknown };
    if (typeof token.id_token !== 'string') throw new SsoProviderError('The provider did not return an ID token');

    const claims = await this.verifyIdToken(token.id_token, meta, issuer, p.clientId);
    if (claims.nonce !== p.nonce) throw new SsoProviderError('The sign-in response did not match this request');
    if (typeof claims.sub !== 'string' || !claims.sub) throw new SsoProviderError('The ID token has no subject');
    const email = typeof claims.email === 'string' ? claims.email.trim().toLowerCase() : '';
    if (!email) throw new SsoProviderError('The provider did not share an email address');
    return {
      subject: claims.sub,
      email,
      emailVerified: claims.email_verified === true || claims.email_verified === 'true',
      name: typeof claims.name === 'string' ? claims.name : null,
    };
  }

  private async verifyIdToken(idToken: string, meta: OidcMetadata, issuer: string, clientId: string) {
    const attempt = async (fresh: boolean) => {
      const cached = this.keys.get(meta.jwks_uri);
      let jwks: JSONWebKeySet;
      if (!fresh && cached && Date.now() - cached.at < CACHE_MS) jwks = cached.value;
      else {
        jwks = (await this.fetchJson(meta.jwks_uri)) as JSONWebKeySet;
        this.keys.set(meta.jwks_uri, { at: Date.now(), value: jwks });
      }
      const { payload } = await jwtVerify(idToken, createLocalJWKSet(jwks), {
        issuer,
        audience: clientId,
        algorithms: ALGORITHMS,
        clockTolerance: 60,
      });
      return payload;
    };
    try {
      return await attempt(false);
    } catch (first) {
      // The provider may have rotated its signing keys since we cached them.
      try {
        return await attempt(true);
      } catch {
        if (first instanceof AppError) throw first;
        throw new SsoProviderError('The ID token could not be verified');
      }
    }
  }
}
