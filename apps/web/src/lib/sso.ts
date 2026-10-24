export interface SsoConnection {
  issuer: string;
  clientId: string;
  hasSecret: boolean;
  allowedDomains: string[];
  requireVerifiedEmail: boolean;
  enabled: boolean;
  enforced: boolean;
  lastLoginAt: string | null;
  updatedAt: string;
}

export interface SsoSettings {
  /** The address to give the identity provider as the sign-in return (redirect) address. */
  redirectUri: string;
  connection: SsoConnection | null;
}

export const ssoKeys = { settings: ['sso', 'connection'] as const };

/** Plain-language reasons shown on the sign-in page after a failed single sign-on. */
export const SSO_ERRORS: Record<string, string> = {
  expired: 'That sign-in took too long or was started in another browser. Please try again.',
  denied: 'Your organisation’s identity provider did not complete the sign-in.',
  unverified_email: 'Your identity provider has not confirmed your email address.',
  wrong_domain: 'That email address isn’t allowed to use single sign-on here.',
  no_access: 'Your account hasn’t been added to this organisation. Ask your administrator.',
  provider: 'We couldn’t finish signing you in with your identity provider. Try again, or ask your administrator.',
  unavailable: 'Single sign-on isn’t set up for that email address.',
};

/** Splits "a.com, b.com" or one per line into clean domains. */
export function parseDomains(text: string): string[] {
  return [
    ...new Set(
      text
        .split(/[\s,;]+/)
        .map((d) => d.trim().toLowerCase().replace(/^@/, ''))
        .filter(Boolean),
    ),
  ];
}
