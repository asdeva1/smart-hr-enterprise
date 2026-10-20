import { Injectable } from '@nestjs/common';
import { hasFeature, type Feature } from '@smart-hr/entitlements';
import type { AuthContext, TenantContext } from '../auth/auth.types.js';
import { ApprovalsService } from '../approvals/approvals.service.js';
import { AssetsService } from '../assets/assets.service.js';
import { AttendanceService } from '../attendance/attendance.service.js';
import { EntitlementsService } from '../entitlements/entitlements.service.js';
import { HolidaysService } from '../leave/holidays.service.js';
import { LeaveService } from '../leave/leave.service.js';
import { OperationsService } from '../operations/operations.service.js';
import { ProjectsService } from '../projects/projects.service.js';

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** One section of the home page. A section that can't be built is left out, never an error for the whole page. */
async function section<T>(build: () => Promise<T>): Promise<T | undefined> {
  try {
    return await build();
  } catch {
    return undefined;
  }
}

/**
 * The signed-in person's home page, gathered from the modules they already use: today's attendance, leave,
 * things waiting for them, their work, time and assets, and, for managers, how their team is today. Every
 * section is read through the same services and permission checks as its own page, so it shows nothing
 * they couldn't already open.
 */
@Injectable()
export class SelfServiceService {
  constructor(
    private readonly attendance: AttendanceService,
    private readonly leave: LeaveService,
    private readonly holidays: HolidaysService,
    private readonly approvals: ApprovalsService,
    private readonly operations: OperationsService,
    private readonly projects: ProjectsService,
    private readonly assets: AssetsService,
    private readonly entitlements: EntitlementsService,
  ) {}

  async home(tenant: TenantContext, auth: AuthContext, now = new Date()) {
    const features = await this.attendance.run(tenant, auth, (tx) => this.entitlements.forTenant(tx));
    const has = (f: Feature) => hasFeature(features, f);
    const year = now.getUTCFullYear();

    const today = has('attendance.basic')
      ? await section(() => this.attendance.today(tenant, auth, now))
      : undefined;
    const date = today && 'date' in today ? today.date : iso(now);
    const weekStart = new Date(now.getTime() - ((now.getUTCDay() + 6) % 7) * 86_400_000);

    const [balances, pendingLeave, inbox, work, time, assets, holidays] = await Promise.all([
      has('leave.basic') ? section(() => this.leave.myBalances(tenant, auth, year)) : undefined,
      has('leave.basic')
        ? section(() => this.leave.list(tenant, auth, { scope: 'mine', status: 'PENDING' }))
        : undefined,
      section(() => this.approvals.inbox(tenant, auth)),
      has('operations.templates') ? section(() => this.operations.mine(tenant, auth)) : undefined,
      has('projects')
        ? section(() => this.projects.myTime(tenant, auth, { from: iso(weekStart), to: iso(now) }))
        : undefined,
      has('assets') ? section(() => this.assets.mine(tenant, auth)) : undefined,
      has('leave.basic') ? section(() => this.holidays.mine(tenant, auth, year)) : undefined,
    ]);

    const upcoming = (holidays?.holidays ?? [])
      .filter((h) => h.date >= date)
      .slice(0, 3)
      .map((h) => ({ date: h.date, name: h.name }));

    return {
      employee: today && today.employee ? today.employee : null,
      date,
      attendance:
        today && 'result' in today
          ? {
              status: today.result.status,
              firstIn: today.result.firstIn,
              openSince: today.result.openSince,
              nextAction: today.nextAction,
              canPunch: today.canPunch,
              holiday: today.holiday ?? null,
              onLeave: today.leave ?? null,
            }
          : null,
      leave: balances
        ? {
            balances: balances.balances.map((b) => ({
              type: b.leaveType.name,
              available: b.available,
            })),
            pending: pendingLeave?.length ?? 0,
          }
        : null,
      waitingForMe: inbox
        ? {
            count: inbox.length,
            overdue: inbox.filter((t) => t.dueAt && t.dueAt < now).length,
            first: inbox.slice(0, 3).map((t) => ({ id: t.id, title: t.request.title, stage: t.stageName })),
          }
        : null,
      work: work
        ? {
            open: work.length,
            overdue: work.filter((i) => i.overdue).length,
            items: work.slice(0, 5).map((i) => ({
              id: i.id,
              ref: i.ref,
              title: i.title,
              stage: i.stage.label,
              dueDate: i.dueDate,
              overdue: i.overdue,
            })),
          }
        : null,
      time: time ? { weekHours: time.totalHours } : null,
      assets: assets ? { count: assets.length } : null,
      holidays: upcoming,
    };
  }

  /** How the signed-in person's team is today, for managers (and anyone with attendance or leave access). */
  async team(tenant: TenantContext, auth: AuthContext, now = new Date()) {
    const features = await this.attendance.run(tenant, auth, (tx) => this.entitlements.forTenant(tx));
    const has = (f: Feature) => hasFeature(features, f);
    const date = iso(now);
    const [day, pending] = await Promise.all([
      has('attendance.basic') ? section(() => this.attendance.team(tenant, auth, { date }, now)) : undefined,
      has('leave.basic')
        ? section(() => this.leave.list(tenant, auth, { scope: 'team', status: 'PENDING' }))
        : undefined,
    ]);
    if (!day && !pending) return null;
    return {
      date,
      counts: day?.counts ?? null,
      notIn: (day?.rows ?? [])
        .filter((r) => r.day.status === null || r.day.status === 'ABSENT')
        .slice(0, 8)
        .map((r) => ({ id: r.employee.id, name: r.employee.name, status: r.day.status })),
      onLeave: (day?.rows ?? [])
        .filter((r) => r.day.status === 'ON_LEAVE')
        .slice(0, 8)
        .map((r) => ({ id: r.employee.id, name: r.employee.name })),
      pendingLeave: pending?.length ?? 0,
    };
  }
}
