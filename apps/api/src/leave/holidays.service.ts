import { Injectable } from '@nestjs/common';
import { isUniqueViolation, type TenantTransaction } from '@smart-hr/database';
import { AppError, defined, ForbiddenError, NotFoundError, type ScopeRef } from '@smart-hr/shared';
import type {
  createHolidayCalendarSchema,
  holidaySchema,
  updateHolidayCalendarSchema,
  updateHolidaySchema,
} from '@smart-hr/validation';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { ATTENDANCE_EMPLOYEE_SELECT, AttendanceService, toDate } from '../attendance/attendance.service.js';
import type { AuthContext, TenantContext } from '../auth/auth.types.js';
import type { RequestMeta } from '../common/request-context.js';
import { OrgIndex } from '../employees/org-index.js';

type Place = z.output<typeof createHolidayCalendarSchema>['place'];

interface CalendarRow {
  id: string;
  name: string;
  companyId: string | null;
  branchId: string | null;
  scopeKey: string;
  status: 'ACTIVE' | 'ARCHIVED';
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

function scopeKeyOf(place: Place): string {
  return place.type === 'TENANT' ? 'TENANT' : `${place.type}:${place.id}`;
}

/**
 * Holiday calendars: one per place (organisation, company or branch). Changing a holiday recalculates any
 * attendance already worked out for that date, so registers stay right.
 */
@Injectable()
export class HolidaysService {
  constructor(
    private readonly attendance: AttendanceService,
    private readonly audit: AuditService,
  ) {}

  /** Every scope a calendar's place sits in, for permission checks. */
  private scopesOf(
    org: OrgIndex,
    tenantId: string,
    c: Pick<CalendarRow, 'companyId' | 'branchId'>,
  ): ScopeRef[] {
    const scopes: ScopeRef[] = [{ type: 'TENANT', id: tenantId }];
    const companyId = c.companyId ?? (c.branchId ? org.branches.get(c.branchId)?.companyId : undefined);
    if (companyId) scopes.push({ type: 'COMPANY', id: companyId });
    if (c.branchId) scopes.push({ type: 'BRANCH', id: c.branchId });
    return scopes;
  }

  private assertCanConfigure(
    tenant: TenantContext,
    org: OrgIndex,
    c: Pick<CalendarRow, 'companyId' | 'branchId'>,
  ) {
    if (!tenant.permissions.allows('leave.configure', this.scopesOf(org, tenant.id, c))) {
      throw new ForbiddenError();
    }
  }

  private placeName(org: OrgIndex, c: Pick<CalendarRow, 'companyId' | 'branchId'>): string {
    if (c.branchId) return org.branches.get(c.branchId)?.name ?? 'Branch';
    if (c.companyId) return org.companies.get(c.companyId)?.name ?? 'Company';
    return 'Whole organisation';
  }

  private view(org: OrgIndex, c: CalendarRow & { _count?: { holidays: number } }) {
    return {
      id: c.id,
      name: c.name,
      status: c.status,
      place: c.branchId
        ? { type: 'BRANCH' as const, id: c.branchId }
        : c.companyId
          ? { type: 'COMPANY' as const, id: c.companyId }
          : { type: 'TENANT' as const },
      placeName: this.placeName(org, c),
      holidays: c._count?.holidays ?? 0,
    };
  }

  async listCalendars(tenant: TenantContext, auth: AuthContext) {
    return this.attendance.run(tenant, auth, async (tx) => {
      const org = await OrgIndex.load(tx, tenant.id);
      const rows = await tx.holidayCalendar.findMany({
        orderBy: [{ status: 'asc' }, { name: 'asc' }],
        include: { _count: { select: { holidays: true } } },
      });
      return rows.map((c) => ({
        ...this.view(org, c),
        canEdit: tenant.permissions.allows('leave.configure', this.scopesOf(org, tenant.id, c)),
      }));
    });
  }

  async createCalendar(
    tenant: TenantContext,
    auth: AuthContext,
    input: z.output<typeof createHolidayCalendarSchema>,
    meta: RequestMeta,
  ) {
    return this.attendance.run(tenant, auth, async (tx) => {
      const org = await OrgIndex.load(tx, tenant.id);
      const place = input.place;
      const row = {
        companyId: place.type === 'COMPANY' ? place.id : null,
        branchId: place.type === 'BRANCH' ? place.id : null,
      };
      if (place.type === 'COMPANY' && org.companies.get(place.id)?.status !== 'ACTIVE') {
        throw new AppError('VALIDATION_FAILED', 'Choose an active company', 400, [
          { path: 'place.id', message: 'Choose an active company' },
        ]);
      }
      if (place.type === 'BRANCH' && org.branches.get(place.id)?.status !== 'ACTIVE') {
        throw new AppError('VALIDATION_FAILED', 'Choose an active branch', 400, [
          { path: 'place.id', message: 'Choose an active branch' },
        ]);
      }
      this.assertCanConfigure(tenant, org, row);

      let calendar;
      try {
        calendar = await tx.holidayCalendar.create({
          data: { tenantId: tenant.id, name: input.name, scopeKey: scopeKeyOf(place), ...row },
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new AppError('CALENDAR_EXISTS', 'This place already has a holiday calendar', 409, [
            { path: 'place', message: 'Already has a calendar' },
          ]);
        }
        throw error;
      }

      let copied = 0;
      if (input.copyFrom) {
        const source = await tx.holidayCalendar.findUnique({ where: { id: input.copyFrom.calendarId } });
        if (!source) throw new NotFoundError('Calendar');
        const holidays = await tx.holiday.findMany({
          where: {
            calendarId: source.id,
            date: {
              gte: toDate(`${input.copyFrom.year}-01-01`),
              lte: toDate(`${input.copyFrom.year}-12-31`),
            },
          },
        });
        if (holidays.length) {
          await tx.holiday.createMany({
            data: holidays.map((h) => ({
              tenantId: tenant.id,
              calendarId: calendar.id,
              date: h.date,
              name: h.name,
              optional: h.optional,
            })),
          });
          copied = holidays.length;
          for (const h of holidays) await this.recomputeDate(tx, iso(h.date));
        }
      }

      await this.audit.recordInTransaction(
        tx,
        {
          action: 'holiday.calendar.create',
          outcome: 'SUCCESS',
          tenantId: tenant.id,
          actorUserId: auth.user.id,
          targetType: 'holiday_calendar',
          targetId: calendar.id,
          metadata: { name: input.name, scope: calendar.scopeKey, copied },
        },
        meta,
      );
      return { ...this.view(org, calendar), holidays: copied, canEdit: true };
    });
  }

  async updateCalendar(
    tenant: TenantContext,
    auth: AuthContext,
    id: string,
    input: z.output<typeof updateHolidayCalendarSchema>,
    meta: RequestMeta,
  ) {
    return this.attendance.run(tenant, auth, async (tx) => {
      const org = await OrgIndex.load(tx, tenant.id);
      const calendar = await tx.holidayCalendar.findUnique({ where: { id } });
      if (!calendar) throw new NotFoundError('Calendar');
      this.assertCanConfigure(tenant, org, calendar);
      const updated = await tx.holidayCalendar.update({
        where: { id },
        data: defined(input),
        include: { _count: { select: { holidays: true } } },
      });
      // Archiving moves people back to a broader calendar, which can change their days.
      if (input.status && input.status !== calendar.status) {
        const dates = await tx.holiday.findMany({ where: { calendarId: id }, select: { date: true } });
        for (const d of dates) await this.recomputeDate(tx, iso(d.date));
      }
      await this.audit.recordInTransaction(
        tx,
        {
          action: 'holiday.calendar.update',
          outcome: 'SUCCESS',
          tenantId: tenant.id,
          actorUserId: auth.user.id,
          targetType: 'holiday_calendar',
          targetId: id,
          metadata: { ...input },
        },
        meta,
      );
      return { ...this.view(org, updated), canEdit: true };
    });
  }

  async listHolidays(tenant: TenantContext, auth: AuthContext, calendarId: string, year: number) {
    return this.attendance.run(tenant, auth, async (tx) => {
      const calendar = await tx.holidayCalendar.findUnique({ where: { id: calendarId } });
      if (!calendar) throw new NotFoundError('Calendar');
      return this.holidaysOf(tx, calendarId, year);
    });
  }

  private async holidaysOf(tx: TenantTransaction, calendarId: string, year: number) {
    const rows = await tx.holiday.findMany({
      where: { calendarId, date: { gte: toDate(`${year}-01-01`), lte: toDate(`${year}-12-31`) } },
      orderBy: { date: 'asc' },
    });
    return rows.map((h) => ({ id: h.id, date: iso(h.date), name: h.name, optional: h.optional }));
  }

  /** The holidays that apply to me: my branch's calendar, else my company's, else the organisation's. */
  async mine(tenant: TenantContext, auth: AuthContext, year: number) {
    return this.attendance.run(tenant, auth, async (tx) => {
      const me = await this.attendance.self(tx, tenant);
      const calendars = await tx.holidayCalendar.findMany({
        where: { status: 'ACTIVE' },
        select: { id: true, name: true, scopeKey: true },
      });
      const byScope = new Map(calendars.map((c) => [c.scopeKey, c]));
      const calendar =
        (me?.branchId && byScope.get(`BRANCH:${me.branchId}`)) ||
        (me?.companyId && byScope.get(`COMPANY:${me.companyId}`)) ||
        byScope.get('TENANT') ||
        null;
      if (!calendar) return { calendar: null, holidays: [] };
      return {
        calendar: { id: calendar.id, name: calendar.name },
        holidays: await this.holidaysOf(tx, calendar.id, year),
      };
    });
  }

  async addHoliday(
    tenant: TenantContext,
    auth: AuthContext,
    calendarId: string,
    input: z.output<typeof holidaySchema>,
    meta: RequestMeta,
  ) {
    return this.attendance.run(tenant, auth, async (tx) => {
      const org = await OrgIndex.load(tx, tenant.id);
      const calendar = await tx.holidayCalendar.findUnique({ where: { id: calendarId } });
      if (!calendar) throw new NotFoundError('Calendar');
      this.assertCanConfigure(tenant, org, calendar);
      let holiday;
      try {
        holiday = await tx.holiday.create({
          data: {
            tenantId: tenant.id,
            calendarId,
            date: toDate(input.date),
            name: input.name,
            optional: input.optional,
          },
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new AppError('HOLIDAY_EXISTS', 'This calendar already has a holiday on that date', 409, [
            { path: 'date', message: 'Already a holiday' },
          ]);
        }
        throw error;
      }
      await this.recomputeDate(tx, input.date);
      await this.audit.recordInTransaction(
        tx,
        {
          action: 'holiday.add',
          outcome: 'SUCCESS',
          tenantId: tenant.id,
          actorUserId: auth.user.id,
          targetType: 'holiday_calendar',
          targetId: calendarId,
          metadata: { date: input.date, name: input.name, optional: input.optional },
        },
        meta,
      );
      return { id: holiday.id, date: input.date, name: holiday.name, optional: holiday.optional };
    });
  }

  async updateHoliday(
    tenant: TenantContext,
    auth: AuthContext,
    id: string,
    input: z.output<typeof updateHolidaySchema>,
    meta: RequestMeta,
  ) {
    return this.attendance.run(tenant, auth, async (tx) => {
      const { holiday, calendar } = await this.loadHoliday(tx, id);
      this.assertCanConfigure(tenant, await OrgIndex.load(tx, tenant.id), calendar);
      const updated = await tx.holiday.update({ where: { id }, data: defined(input) });
      if (input.optional !== undefined && input.optional !== holiday.optional) {
        await this.recomputeDate(tx, iso(holiday.date));
      }
      await this.audit.recordInTransaction(
        tx,
        {
          action: 'holiday.update',
          outcome: 'SUCCESS',
          tenantId: tenant.id,
          actorUserId: auth.user.id,
          targetType: 'holiday_calendar',
          targetId: calendar.id,
          metadata: { date: iso(holiday.date), ...input },
        },
        meta,
      );
      return { id, date: iso(updated.date), name: updated.name, optional: updated.optional };
    });
  }

  async removeHoliday(tenant: TenantContext, auth: AuthContext, id: string, meta: RequestMeta) {
    await this.attendance.run(tenant, auth, async (tx) => {
      const { holiday, calendar } = await this.loadHoliday(tx, id);
      this.assertCanConfigure(tenant, await OrgIndex.load(tx, tenant.id), calendar);
      await tx.holiday.delete({ where: { id } });
      await this.recomputeDate(tx, iso(holiday.date));
      await this.audit.recordInTransaction(
        tx,
        {
          action: 'holiday.remove',
          outcome: 'SUCCESS',
          tenantId: tenant.id,
          actorUserId: auth.user.id,
          targetType: 'holiday_calendar',
          targetId: calendar.id,
          metadata: { date: iso(holiday.date), name: holiday.name },
        },
        meta,
      );
    });
  }

  private async loadHoliday(tx: TenantTransaction, id: string) {
    const holiday = await tx.holiday.findUnique({ where: { id }, include: { calendar: true } });
    if (!holiday) throw new NotFoundError('Holiday');
    return { holiday, calendar: holiday.calendar };
  }

  /** Recalculates every stored attendance day on a date, so a holiday change shows in registers at once. */
  private async recomputeDate(tx: TenantTransaction, date: string) {
    const days = await tx.attendanceDay.findMany({
      where: { date: toDate(date) },
      select: { employee: { select: ATTENDANCE_EMPLOYEE_SELECT } },
    });
    for (const d of days) await this.attendance.recompute(tx, d.employee, date);
  }
}
