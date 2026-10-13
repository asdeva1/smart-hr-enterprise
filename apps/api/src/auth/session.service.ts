import { Inject, Injectable } from '@nestjs/common';
import { generateToken, hashToken } from '@smart-hr/auth';
import type { DatabaseClient, User, UserSession } from '@smart-hr/database';
import type { RequestMeta } from '../common/request-context.js';
import type { ApiEnv } from '../config/env.js';
import { API_ENV, DATABASE } from '../infra/tokens.js';

export interface IssuedSession {
  session: UserSession;
  /** Raw token for the cookie. Never stored or logged. */
  token: string;
}

/** Don't write last_seen_at on every request; once a minute is precise enough for idle expiry. */
const TOUCH_INTERVAL_MS = 60_000;

@Injectable()
export class SessionService {
  constructor(
    @Inject(DATABASE) private readonly db: DatabaseClient,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  private idleExpiry(from: Date): Date {
    return new Date(from.getTime() + this.env.AUTH_SESSION_IDLE_MINUTES * 60_000);
  }

  async create(
    userId: string,
    options: {
      mfaPending: boolean;
      activeTenantId: string | null;
      reauthenticated: boolean;
      /** Shorter idle window, e.g. for a session still waiting for its second factor. */
      idleMinutes?: number;
    },
    meta: RequestMeta,
  ): Promise<IssuedSession> {
    const token = generateToken();
    const now = new Date();
    const session = await this.db.userSession.create({
      data: {
        userId,
        tokenHash: hashToken(token),
        csrfToken: generateToken(),
        activeTenantId: options.activeTenantId,
        mfaPending: options.mfaPending,
        reauthenticatedAt: options.reauthenticated ? now : null,
        idleExpiresAt:
          options.idleMinutes === undefined
            ? this.idleExpiry(now)
            : new Date(now.getTime() + options.idleMinutes * 60_000),
        absoluteExpiresAt: new Date(now.getTime() + this.env.AUTH_SESSION_ABSOLUTE_HOURS * 3_600_000),
        ipAddress: meta.ip,
        userAgent: meta.userAgent,
      },
    });
    return { session, token };
  }

  /**
   * Returns the session and user for a cookie token, or null if the session is unknown, revoked, idle,
   * past its absolute lifetime, or the user is disabled. Extends the idle window on use.
   */
  async resolve(token: string): Promise<{ session: UserSession; user: User } | null> {
    if (!token || token.length > 128) return null;
    const found = await this.db.userSession.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { user: true },
    });
    if (!found) return null;
    const { user, ...session } = found;
    const now = new Date();
    if (session.revokedAt || session.idleExpiresAt <= now || session.absoluteExpiresAt <= now) return null;
    if (user.status !== 'ACTIVE') return null;

    // A session waiting for its second factor keeps its short fixed window.
    if (!session.mfaPending && now.getTime() - session.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
      const idleExpiresAt = this.idleExpiry(now);
      await this.db.userSession.update({
        where: { id: session.id },
        data: { lastSeenAt: now, idleExpiresAt },
      });
      session.lastSeenAt = now;
      session.idleExpiresAt = idleExpiresAt;
    }
    return { session, user };
  }

  /**
   * Issues a new token (and CSRF token) for an existing session. Called whenever privilege changes —
   * second factor completed, tenant switched, password changed — so a token captured earlier stops working.
   */
  async rotate(
    sessionId: string,
    changes: Partial<Pick<UserSession, 'mfaPending' | 'activeTenantId' | 'reauthenticatedAt'>> = {},
  ): Promise<IssuedSession> {
    const token = generateToken();
    const now = new Date();
    const session = await this.db.userSession.update({
      where: { id: sessionId },
      data: {
        ...changes,
        tokenHash: hashToken(token),
        csrfToken: generateToken(),
        lastSeenAt: now,
        idleExpiresAt: this.idleExpiry(now),
      },
    });
    return { session, token };
  }

  async markReauthenticated(sessionId: string): Promise<void> {
    await this.db.userSession.update({ where: { id: sessionId }, data: { reauthenticatedAt: new Date() } });
  }

  async revoke(sessionId: string, reason: string): Promise<void> {
    await this.db.userSession.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date(), revokeReason: reason },
    });
  }

  /** Revokes every live session of a user, optionally keeping one. Returns how many were revoked. */
  async revokeAllForUser(userId: string, reason: string, exceptSessionId?: string): Promise<number> {
    const result = await this.db.userSession.updateMany({
      where: { userId, revokedAt: null, ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}) },
      data: { revokedAt: new Date(), revokeReason: reason },
    });
    return result.count;
  }

  /** The user's live sessions, newest first. */
  async listActive(userId: string): Promise<UserSession[]> {
    const now = new Date();
    return this.db.userSession.findMany({
      where: { userId, revokedAt: null, idleExpiresAt: { gt: now }, absoluteExpiresAt: { gt: now } },
      orderBy: { lastSeenAt: 'desc' },
      take: 50,
    });
  }
}
