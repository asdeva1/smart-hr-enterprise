import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { DatabaseClient, InstallationLicence, TenantTransaction } from '@smart-hr/database';
import { isUniqueViolation } from '@smart-hr/database';
import {
  decodeUnverified,
  licenceState,
  verifyLicence,
  type LicencePayload,
  type LicenceState,
  type VerifyFailure,
} from '@smart-hr/licensing';
import { AppError } from '@smart-hr/shared';
import { AuditService } from '../audit/audit.service.js';
import type { AuthContext } from '../auth/auth.types.js';
import type { RequestMeta } from '../common/request-context.js';
import type { ApiEnv } from '../config/env.js';
import { API_ENV, DATABASE } from '../infra/tokens.js';
import { asPlatform } from '../platform/platform-context.js';

export interface CurrentLicence {
  row: InstallationLicence;
  /** Null when the stored licence no longer verifies (e.g. its key was removed from LICENCE_PUBLIC_KEYS). */
  payload: LicencePayload | null;
  /** The unverified payload of a licence that no longer verifies; only ever used read-only. */
  unverified: LicencePayload | null;
  failure: VerifyFailure | null;
  state: LicenceState | null;
}

const FAILURE_TEXT: Record<VerifyFailure, string> = {
  MALFORMED: 'This doesn’t look like a Smart HR licence. Paste the whole licence text.',
  UNSUPPORTED_VERSION: 'This licence is for a different version of Smart HR.',
  UNKNOWN_KEY: 'This licence was signed with a key this installation doesn’t trust.',
  BAD_SIGNATURE: 'This licence has been changed since it was issued.',
  INVALID_PAYLOAD: 'This licence is incomplete.',
};

/**
 * The installation's signed licence (in-house deployments only). Verified offline on every read; nothing
 * here contacts Smartclues. A licence problem makes paid modules read-only — it never hides or deletes data.
 */
@Injectable()
export class LicenceService {
  private installation?: string;
  private readonly verified = new Map<string, ReturnType<typeof verifyLicence>>();

  constructor(
    @Inject(DATABASE) private readonly db: DatabaseClient,
    @Inject(API_ENV) private readonly env: ApiEnv,
    private readonly audit: AuditService,
  ) {}

  get inHouse(): boolean {
    return this.env.DEPLOYMENT_MODE === 'inhouse';
  }

  async installationId(tx: TenantTransaction | DatabaseClient = this.db): Promise<string> {
    this.installation ??= (await tx.installation.findFirstOrThrow({ select: { id: true } })).id;
    return this.installation;
  }

  /** Verification is pure, so results are cached per licence text. */
  private verify(token: string) {
    const key = createHash('sha256').update(token).digest('hex');
    let result = this.verified.get(key);
    if (!result) {
      result = verifyLicence(token, this.env.LICENCE_PUBLIC_KEYS);
      this.verified.set(key, result);
    }
    return result;
  }

  async current(
    tx: TenantTransaction | DatabaseClient = this.db,
    now = new Date(),
  ): Promise<CurrentLicence | null> {
    const row = await tx.installationLicence.findFirst({
      where: { replacedAt: null },
      orderBy: { installedAt: 'desc' },
    });
    if (!row) return null;
    const result = this.verify(row.token);
    if (!result.ok) {
      return {
        row,
        payload: null,
        unverified: decodeUnverified(row.token),
        failure: result.reason,
        state: null,
      };
    }
    return {
      row,
      payload: result.payload,
      unverified: null,
      failure: null,
      state: licenceState(result.payload, await this.installationId(tx), now),
    };
  }

  async overview(auth: AuthContext) {
    return asPlatform(this.db, auth, async (tx) => {
      const current = await this.current(tx);
      const history = await tx.installationLicence.findMany({
        orderBy: { installedAt: 'desc' },
        take: 20,
        select: {
          licenceId: true,
          customerName: true,
          planCode: true,
          expiresAt: true,
          installedAt: true,
          replacedAt: true,
          installedBy: { select: { displayName: true, email: true } },
        },
      });
      return {
        deploymentMode: this.env.DEPLOYMENT_MODE,
        installationId: await this.installationId(tx),
        current: current && {
          licenceId: current.row.licenceId,
          installedAt: current.row.installedAt,
          failure: current.failure,
          state: current.state,
          payload: current.payload && {
            customer: current.payload.customer,
            plan: current.payload.plan,
            supportLevel: current.payload.supportLevel,
            features: current.payload.features,
            limits: current.payload.limits,
            notBefore: current.payload.notBefore,
            expiresAt: current.payload.expiresAt,
            graceDays: current.payload.graceDays,
            maxOrganisations: current.payload.maxOrganisations,
            boundToThisInstallation: current.payload.installationId !== null,
          },
        },
        history,
      };
    });
  }

  async install(auth: AuthContext, token: string, meta: RequestMeta) {
    if (!this.inHouse) {
      throw new AppError(
        'LICENCE_NOT_USED',
        'This deployment uses subscriptions, not licence files. Licences are only for in-house installations.',
        409,
      );
    }
    const result = this.verify(token);
    if (!result.ok) {
      await this.audit.record(
        {
          action: 'platform.licence.install',
          outcome: 'FAILURE',
          actorUserId: auth.user.id,
          metadata: { reason: result.reason },
        },
        meta,
      );
      throw new AppError('LICENCE_INVALID', FAILURE_TEXT[result.reason], 422, [
        { path: 'licence', message: FAILURE_TEXT[result.reason] },
      ]);
    }
    const payload = result.payload;
    const state = licenceState(payload, await this.installationId(), new Date());
    if (state.status === 'WRONG_INSTALLATION') {
      throw new AppError(
        'LICENCE_WRONG_INSTALLATION',
        'This licence was issued for a different installation.',
        422,
        [{ path: 'licence', message: 'Issued for a different installation' }],
      );
    }
    if (state.status === 'EXPIRED') {
      throw new AppError(
        'LICENCE_EXPIRED',
        'This licence has already expired. Ask Smartclues for a renewal.',
        422,
        [{ path: 'licence', message: 'Already expired' }],
      );
    }

    try {
      return await asPlatform(this.db, auth, async (tx) => {
        // One installer at a time, so two uploads can't both become current.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('installation_licence'))`;
        await tx.installationLicence.updateMany({
          where: { replacedAt: null },
          data: { replacedAt: new Date() },
        });
        await tx.installationLicence.create({
          data: {
            licenceId: payload.licenceId,
            token: token.trim(),
            customerName: payload.customer.name,
            planCode: payload.plan.code,
            expiresAt: new Date(payload.expiresAt),
            installedByUserId: auth.user.id,
          },
        });
        await this.audit.recordInTransaction(
          tx,
          {
            action: 'platform.licence.install',
            outcome: 'SUCCESS',
            actorUserId: auth.user.id,
            targetType: 'licence',
            targetId: payload.licenceId,
            metadata: { plan: payload.plan.code, expiresAt: payload.expiresAt, status: state.status },
          },
          meta,
        );
        return { licenceId: payload.licenceId, state };
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new AppError('LICENCE_ALREADY_INSTALLED', 'This licence has been installed before.', 409);
      }
      throw error;
    }
  }

  /** Refuses a new organisation when the licence caps how many this installation may hold. */
  async assertCanAddOrganisation(tx: TenantTransaction): Promise<void> {
    if (!this.inHouse) return;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('licence:organisations'))`;
    const current = await this.current(tx);
    const max = current?.payload?.maxOrganisations;
    if (max === undefined || max === null) return;
    const count = await tx.tenant.count({ where: { status: { not: 'ARCHIVED' } } });
    if (count >= max) {
      throw new AppError(
        'LICENCE_LIMIT_REACHED',
        `This installation’s licence allows ${max} organisation${max === 1 ? '' : 's'}. Archive one or ask Smartclues for a larger licence.`,
        409,
      );
    }
  }
}
