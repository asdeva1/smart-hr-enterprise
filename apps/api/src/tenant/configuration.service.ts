import { Inject, Injectable } from '@nestjs/common';
import { withContext, type DatabaseClient, type TenantTransaction } from '@smart-hr/database';
import { AppError, ForbiddenError } from '@smart-hr/shared';
import {
  isOrganisationSetting,
  ORGANISATION_SETTINGS,
  parseSetting,
  type OrganisationSettingKey,
  type OrganisationSettings,
} from '@smart-hr/validation';
import { AuditService } from '../audit/audit.service.js';
import type { AuthContext, TenantContext } from '../auth/auth.types.js';
import type { RequestMeta } from '../common/request-context.js';
import { DATABASE } from '../infra/tokens.js';

const KEYS = Object.keys(ORGANISATION_SETTINGS) as OrganisationSettingKey[];

/**
 * Typed organisation settings. Every key is declared with a schema and a default in
 * `ORGANISATION_SETTINGS`, so modules always get a valid value and unknown keys are refused.
 */
@Injectable()
export class ConfigurationService {
  constructor(
    @Inject(DATABASE) private readonly db: DatabaseClient,
    private readonly audit: AuditService,
  ) {}

  /** Effective settings inside an existing tenant transaction (for other modules). */
  async effective(tx: TenantTransaction): Promise<OrganisationSettings> {
    const rows = await tx.tenantSetting.findMany({
      where: { key: { in: KEYS } },
      select: { key: true, value: true },
    });
    const stored = new Map(rows.map((r) => [r.key, r.value]));
    const result: Record<string, unknown> = {};
    for (const key of KEYS) {
      const parsed = stored.has(key) ? parseSetting(key, stored.get(key)) : null;
      // A stored value that no longer validates (e.g. after a schema change) falls back to the default.
      result[key] = parsed?.ok ? parsed.value : ORGANISATION_SETTINGS[key].default;
    }
    return result as OrganisationSettings;
  }

  /** Every setting with its metadata, current value and whether it is the default. */
  async describe(tenant: TenantContext, auth: AuthContext) {
    return withContext(this.db, { tenantId: tenant.id, userId: auth.user.id }, async (tx) => {
      const rows = await tx.tenantSetting.findMany({
        where: { key: { in: KEYS } },
        select: { key: true, updatedAt: true },
      });
      const values = await this.effective(tx);
      return KEYS.map((key) => {
        const def = ORGANISATION_SETTINGS[key];
        const row = rows.find((r) => r.key === key);
        return {
          key,
          group: def.group,
          label: def.label,
          description: def.description,
          input: def.input,
          value: values[key],
          default: def.default,
          isDefault: !row,
          updatedAt: row?.updatedAt ?? null,
        };
      });
    });
  }

  /**
   * Validates every value first, then saves them together and records one audit event with what changed.
   * Setting a key back to its default removes the stored row.
   */
  async update(tenant: TenantContext, auth: AuthContext, values: Record<string, unknown>, meta: RequestMeta) {
    if (!tenant.permissions.allowsTenantWide('settings.manage')) throw new ForbiddenError();
    const parsed: [OrganisationSettingKey, unknown][] = [];
    const problems: { path: string; message: string }[] = [];
    for (const [key, raw] of Object.entries(values)) {
      if (!isOrganisationSetting(key)) {
        problems.push({ path: `values.${key}`, message: 'Unknown setting' });
        continue;
      }
      const result = parseSetting(key, raw);
      if (result.ok) parsed.push([key, result.value]);
      else problems.push({ path: `values.${key}`, message: result.message });
    }
    if (problems.length > 0)
      throw new AppError('VALIDATION_FAILED', 'Some settings are not valid', 400, problems);

    return withContext(this.db, { tenantId: tenant.id, userId: auth.user.id }, async (tx) => {
      const before = await this.effective(tx);
      const changed: Record<string, { from: unknown; to: unknown }> = {};
      for (const [key, value] of parsed) {
        if (JSON.stringify(before[key]) === JSON.stringify(value)) continue;
        changed[key] = { from: before[key], to: value };
        if (JSON.stringify(value) === JSON.stringify(ORGANISATION_SETTINGS[key].default)) {
          await tx.tenantSetting.deleteMany({ where: { key } });
        } else {
          await tx.tenantSetting.upsert({
            where: { tenantId_key: { tenantId: tenant.id, key } },
            create: { tenantId: tenant.id, key, value: value as object },
            update: { value: value as object },
          });
        }
      }
      if (Object.keys(changed).length > 0) {
        // Settings hold no personal data, so old and new values are kept for the record.
        await this.audit.recordInTransaction(
          tx,
          {
            action: 'tenant.configuration.update',
            outcome: 'SUCCESS',
            tenantId: tenant.id,
            actorUserId: auth.user.id,
            targetType: 'tenant',
            targetId: tenant.id,
            metadata: { changed },
          },
          meta,
        );
      }
      return { changed: Object.keys(changed), values: await this.effective(tx) };
    });
  }
}
