import { Inject, Injectable } from '@nestjs/common';
import type { DatabaseClient } from '@smart-hr/database';
import { decodeUnverified, verifyLicence } from '@smart-hr/licensing';
import { AppError } from '@smart-hr/shared';
import { AuditService } from '../audit/audit.service.js';
import type { AuthContext } from '../auth/auth.types.js';
import type { RequestMeta } from '../common/request-context.js';
import type { ApiEnv } from '../config/env.js';
import { API_ENV, DATABASE } from '../infra/tokens.js';
import { asPlatform } from './platform-context.js';

const DAY = 86_400_000;

/** How close to expiry a licence or subscription is. DUE is 30 days or fewer; SOON is 60 days or fewer. */
export type RenewalStage = 'OK' | 'SOON' | 'DUE' | 'GRACE' | 'EXPIRED' | 'REVOKED' | 'NOT_YET_VALID';

export function renewalStage(
  input: { expiresAt: Date; graceDays: number; notBefore?: Date; revoked?: boolean },
  now = new Date(),
): { stage: RenewalStage; daysLeft: number } {
  const daysLeft = Math.floor((input.expiresAt.getTime() - now.getTime()) / DAY);
  if (input.revoked) return { stage: 'REVOKED', daysLeft };
  if (input.notBefore && now < input.notBefore) return { stage: 'NOT_YET_VALID', daysLeft };
  if (now >= input.expiresAt) {
    const graceEnds = input.expiresAt.getTime() + input.graceDays * DAY;
    return { stage: now.getTime() < graceEnds ? 'GRACE' : 'EXPIRED', daysLeft };
  }
  if (daysLeft <= 30) return { stage: 'DUE', daysLeft };
  if (daysLeft <= 60) return { stage: 'SOON', daysLeft };
  return { stage: 'OK', daysLeft };
}

/**
 * The register of licences issued to in-house customers, plus a renewals view that also lists hosted
 * subscriptions about to end. The signing key is never on this server: a licence is issued with the
 * command-line tool and then recorded here (pasted in), which keeps the dates, the customer and the notes.
 */
@Injectable()
export class LicenceRegisterService {
  constructor(
    @Inject(DATABASE) private readonly db: DatabaseClient,
    @Inject(API_ENV) private readonly env: ApiEnv,
    private readonly audit: AuditService,
  ) {}

  async overview(auth: AuthContext, now = new Date()) {
    return asPlatform(this.db, auth, async (tx) => {
      const rows = await tx.issuedLicence.findMany({
        orderBy: [{ expiresAt: 'asc' }],
        take: 500,
        include: { recordedBy: { select: { displayName: true } } },
      });
      const licences = rows.map((row) => {
        const { stage, daysLeft } = renewalStage(
          {
            expiresAt: row.expiresAt,
            graceDays: row.graceDays,
            notBefore: row.notBefore,
            revoked: row.status === 'REVOKED',
          },
          now,
        );
        return {
          id: row.id,
          licenceId: row.licenceId,
          customerName: row.customerName,
          planCode: row.planCode,
          planName: row.planName,
          supportLevel: row.supportLevel,
          issuedAt: row.issuedAt,
          notBefore: row.notBefore,
          expiresAt: row.expiresAt,
          graceDays: row.graceDays,
          signatureChecked: row.signatureChecked,
          notes: row.notes,
          status: row.status,
          revokedAt: row.revokedAt,
          revokedReason: row.revokedReason,
          renewedById: row.renewedById,
          recordedBy: row.recordedBy?.displayName ?? null,
          stage,
          daysLeft,
        };
      });
      // A licence that has been renewed no longer needs a reminder of its own.
      const needsAction = (l: (typeof licences)[number]) =>
        l.status === 'ACTIVE' && !l.renewedById && ['SOON', 'DUE', 'GRACE', 'EXPIRED'].includes(l.stage);

      const subscriptions = await tx.subscription.findMany({
        where: { status: { in: ['TRIAL', 'ACTIVE', 'PAST_DUE'] } },
        include: {
          tenant: { select: { id: true, name: true } },
          planVersion: { select: { graceDays: true, plan: { select: { name: true, code: true } } } },
        },
      });
      const renewals = subscriptions
        .flatMap((s) => {
          const ends = s.status === 'TRIAL' ? s.trialEndsAt : s.currentPeriodEnd;
          if (!ends) return [];
          const { stage, daysLeft } = renewalStage(
            { expiresAt: ends, graceDays: s.planVersion.graceDays },
            now,
          );
          if (stage === 'OK') return [];
          return [
            {
              tenantId: s.tenant.id,
              organisation: s.tenant.name,
              plan: s.planVersion.plan.name,
              kind: s.status === 'TRIAL' ? ('TRIAL' as const) : ('SUBSCRIPTION' as const),
              endsAt: ends,
              stage,
              daysLeft,
            },
          ];
        })
        .sort((a, b) => a.daysLeft - b.daysLeft);

      const actionable = licences.filter(needsAction);
      return {
        licences,
        renewals,
        summary: {
          licencesDue: actionable.filter((l) => l.stage === 'DUE' || l.stage === 'SOON').length,
          licencesLapsed: actionable.filter((l) => l.stage === 'GRACE' || l.stage === 'EXPIRED').length,
          subscriptionsDue: renewals.filter((r) => r.stage === 'DUE' || r.stage === 'SOON').length,
          subscriptionsLapsed: renewals.filter((r) => r.stage === 'GRACE' || r.stage === 'EXPIRED').length,
        },
      };
    });
  }

  async record(
    auth: AuthContext,
    input: { licence: string; notes?: string | undefined; renews?: string | undefined },
    meta: RequestMeta,
  ) {
    const token = input.licence.trim();
    const verified = verifyLicence(token, this.env.LICENCE_PUBLIC_KEYS);
    // Without a trusted key on this server the licence is read but not proven; the register says so.
    const payload = verified.ok ? verified.payload : decodeUnverified(token);
    if (!payload) {
      throw new AppError('LICENCE_INVALID', 'This doesn’t look like a Smart HR licence.', 422, [
        { path: 'licence', message: 'Not a readable licence' },
      ]);
    }
    if (!verified.ok && verified.reason === 'BAD_SIGNATURE') {
      throw new AppError('LICENCE_INVALID', 'This licence has been changed since it was issued.', 422, [
        { path: 'licence', message: 'Signature does not match' },
      ]);
    }
    try {
      return await asPlatform(this.db, auth, async (tx) => {
        const row = await tx.issuedLicence.create({
          data: {
            licenceId: payload.licenceId,
            token,
            customerName: payload.customer.name,
            planCode: payload.plan.code,
            planName: payload.plan.name,
            supportLevel: payload.supportLevel,
            issuedAt: new Date(payload.issuedAt),
            notBefore: new Date(payload.notBefore),
            expiresAt: new Date(payload.expiresAt),
            graceDays: payload.graceDays,
            signatureChecked: verified.ok,
            notes: input.notes ?? null,
            recordedByUserId: auth.user.id,
          },
        });
        if (input.renews) {
          const updated = await tx.issuedLicence.updateMany({
            where: { id: input.renews, renewedById: null },
            data: { renewedById: row.id },
          });
          if (updated.count !== 1) {
            throw new AppError(
              'NOT_FOUND',
              'The licence being renewed was not found or is already renewed.',
              404,
            );
          }
        }
        await this.audit.recordInTransaction(
          tx,
          {
            action: 'platform.licence.record',
            outcome: 'SUCCESS',
            actorUserId: auth.user.id,
            targetType: 'issued_licence',
            targetId: row.id,
            metadata: {
              customer: row.customerName,
              expiresAt: row.expiresAt.toISOString(),
              checked: verified.ok,
            },
          },
          meta,
        );
        return { id: row.id, signatureChecked: verified.ok };
      });
    } catch (error) {
      if (error instanceof Error && 'code' in error && (error as { code?: string }).code === 'P2002') {
        throw new AppError('LICENCE_ALREADY_RECORDED', 'This licence is already in the register.', 409);
      }
      throw error;
    }
  }

  async revoke(auth: AuthContext, id: string, reason: string, meta: RequestMeta) {
    return asPlatform(this.db, auth, async (tx) => {
      const updated = await tx.issuedLicence.updateMany({
        where: { id, status: 'ACTIVE' },
        data: { status: 'REVOKED', revokedAt: new Date(), revokedReason: reason },
      });
      if (updated.count !== 1) throw new AppError('NOT_FOUND', 'Licence not found or already revoked.', 404);
      await this.audit.recordInTransaction(
        tx,
        {
          action: 'platform.licence.revoke',
          outcome: 'SUCCESS',
          actorUserId: auth.user.id,
          targetType: 'issued_licence',
          targetId: id,
          metadata: { reason },
        },
        meta,
      );
      return { ok: true };
    });
  }

  async setNotes(auth: AuthContext, id: string, notes: string) {
    return asPlatform(this.db, auth, async (tx) => {
      const updated = await tx.issuedLicence.updateMany({ where: { id }, data: { notes: notes || null } });
      if (updated.count !== 1) throw new AppError('NOT_FOUND', 'Licence not found.', 404);
      return { ok: true };
    });
  }

  /** The licence text itself, to send again to the customer. */
  async token(auth: AuthContext, id: string) {
    return asPlatform(this.db, auth, async (tx) => {
      const row = await tx.issuedLicence.findUnique({ where: { id }, select: { token: true } });
      if (!row) throw new AppError('NOT_FOUND', 'Licence not found.', 404);
      return { licence: row.token };
    });
  }
}
