import { Inject, Injectable } from '@nestjs/common';
import { withContext, type DatabaseClient, type TenantTransaction } from '@smart-hr/database';
import { DATABASE } from '../infra/tokens.js';
import { AppError } from '@smart-hr/shared';
import { zonedInstant } from './attendance-calc.js';
import {
  ATTENDANCE_EMPLOYEE_SELECT,
  AttendanceService,
  type AttendanceEmployee,
} from './attendance.service.js';

type Outcome = 'IMPORTED' | 'UNMAPPED' | 'DUPLICATE' | 'REJECTED';

export interface Scan {
  code: string;
  at: Date;
  rawStatus: number | null;
  verifyMode: number | null;
}

/** Two scans this close are one person touching the sensor twice. */
const DUPLICATE_WINDOW_MS = 60_000;
/** A scan further ahead than this means the machine's clock is wrong. */
const FUTURE_TOLERANCE_MS = 10 * 60_000;
const MAX_SCANS_PER_REQUEST = 2_000;
const CHUNK = 200;

// PIN, date, time, then status, verify mode and more, separated by tabs (or spaces on some firmware).
const LINE = /^(\S+)\s+(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\s+(.*))?$/;

function intOrNull(value: string | undefined): number | null {
  return value !== undefined && /^-?\d{1,6}$/.test(value) ? Number(value) : null;
}

/**
 * Reads the scan lines a machine uploads (the ATTLOG table of the ZKTeco/eSSL push protocol). Times are the
 * machine's own local clock, so they are placed in the machine's time zone. Lines that don't parse are skipped.
 */
export function parseAttlog(body: string, timeZone: string): Scan[] {
  const scans: Scan[] = [];
  for (const raw of body.split(/\r?\n/)) {
    const m = LINE.exec(raw.trim());
    if (!m) continue;
    const [, code, date, hh, mm, ss, rest] = m as unknown as [
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string | undefined,
    ];
    const hour = Number(hh);
    const minute = Number(mm);
    const second = Number(ss);
    if (hour > 23 || minute > 59 || second > 59 || code.length > 20 || !/^[A-Za-z0-9]+$/.test(code)) continue;
    const at = new Date(zonedInstant(date, hour * 60 + minute, timeZone).getTime() + second * 1000);
    if (Number.isNaN(at.getTime())) continue;
    const fields = (rest ?? '').split(/\s+/).filter(Boolean);
    scans.push({ code, at, rawStatus: intOrNull(fields[0]), verifyMode: intOrNull(fields[1]) });
    if (scans.length >= MAX_SCANS_PER_REQUEST) break;
  }
  return scans.sort((a, b) => a.at.getTime() - b.at.getTime());
}

export interface KnownDevice {
  tenantId: string;
  deviceId: string;
  timeZone: string;
  stamp: string | null;
}

/**
 * The receiving end of biometric machines. A machine has no login: it names itself by serial number, and is
 * only listened to if an organisation has registered that serial number and it is active.
 */
@Injectable()
export class BiometricIngestService {
  constructor(
    @Inject(DATABASE) private readonly db: DatabaseClient,
    private readonly attendance: AttendanceService,
  ) {}

  /** Finds the organisation a machine belongs to, or null for an unknown or archived machine. */
  async find(serial: string): Promise<KnownDevice | null> {
    if (!/^[A-Za-z0-9_-]{4,40}$/.test(serial)) return null;
    const rows = await this.db.$queryRaw<
      { tenant_id: string; device_id: string; time_zone: string; attlog_stamp: string | null }[]
    >`SELECT tenant_id, device_id, time_zone, attlog_stamp FROM biometric_device_lookup(${serial})`;
    const row = rows[0];
    return row
      ? { tenantId: row.tenant_id, deviceId: row.device_id, timeZone: row.time_zone, stamp: row.attlog_stamp }
      : null;
  }

  /** The machine's start-up call: notes that it is alive and tells it how to behave. */
  async handshake(device: KnownDevice, serial: string, now = new Date()): Promise<string> {
    await withContext(this.db, { tenantId: device.tenantId }, (tx) =>
      tx.biometricDevice.update({ where: { id: device.deviceId }, data: { lastSeenAt: now } }),
    );
    return [
      `GET OPTION FROM: ${serial}`,
      `ATTLOGStamp=${device.stamp ?? 'None'}`,
      'OPERLOGStamp=9999',
      'ATTPHOTOStamp=None',
      'ErrorDelay=60',
      'Delay=30',
      'TransTimes=00:00;12:00',
      'TransInterval=1',
      'TransFlag=TransData AttLog',
      'Realtime=1',
      'Encrypt=None',
      '',
    ].join('\n');
  }

  /** Stores the uploaded scans and turns each one into attendance. Returns how many lines were read. */
  async receive(
    device: KnownDevice,
    body: string,
    stamp: string | undefined,
    now = new Date(),
  ): Promise<number> {
    const scans = parseAttlog(body, device.timeZone);
    for (let i = 0; i < scans.length; i += CHUNK) {
      const chunk = scans.slice(i, i + CHUNK);
      await withContext(this.db, { tenantId: device.tenantId }, (tx) => this.store(tx, device, chunk, now));
    }
    const newest = scans.at(-1)?.at;
    await withContext(this.db, { tenantId: device.tenantId }, (tx) =>
      tx.biometricDevice.update({
        where: { id: device.deviceId },
        data: {
          lastSeenAt: now,
          ...(newest ? { lastPunchAt: newest } : {}),
          ...(stamp && /^[0-9A-Za-z]{1,40}$/.test(stamp) ? { attlogStamp: stamp } : {}),
        },
      }),
    );
    return scans.length;
  }

  private async store(tx: TenantTransaction, device: KnownDevice, scans: Scan[], now: Date) {
    if (scans.length === 0) return;
    // The same scan can arrive twice (a retry, or the machine resending); keep the first.
    const existing = await tx.biometricLog.findMany({
      where: { deviceId: device.deviceId, OR: scans.map((s) => ({ deviceCode: s.code, punchedAt: s.at })) },
      select: { deviceCode: true, punchedAt: true },
    });
    const seen = new Set(existing.map((e) => `${e.deviceCode}|${e.punchedAt.getTime()}`));
    const fresh = scans.filter((s) => !seen.has(`${s.code}|${s.at.getTime()}`));
    if (fresh.length === 0) return;

    const links = await tx.biometricEnrollment.findMany({
      where: { deviceCode: { in: [...new Set(fresh.map((s) => s.code))] } },
      select: { deviceCode: true, employeeId: true },
    });
    const employeeOf = new Map(links.map((l) => [l.deviceCode, l.employeeId]));
    const employees = new Map(
      (
        await tx.employee.findMany({
          where: { id: { in: [...new Set(links.map((l) => l.employeeId))] } },
          select: ATTENDANCE_EMPLOYEE_SELECT,
        })
      ).map((e) => [e.id, e]),
    );

    for (const scan of fresh) {
      const employee = employees.get(employeeOf.get(scan.code) ?? '');
      const outcome = await this.place(tx, employee, scan.at, now);
      await tx.biometricLog.create({
        data: {
          tenantId: device.tenantId,
          deviceId: device.deviceId,
          deviceCode: scan.code,
          punchedAt: scan.at,
          rawStatus: scan.rawStatus,
          verifyMode: scan.verifyMode,
          outcome,
          employeeId: employee?.id ?? null,
        },
      });
    }
  }

  private async place(
    tx: TenantTransaction,
    employee: AttendanceEmployee | undefined,
    at: Date,
    now: Date,
  ): Promise<Outcome> {
    if (!employee) return 'UNMAPPED';
    if (employee.status === 'EXITED' || at.getTime() > now.getTime() + FUTURE_TOLERANCE_MS) return 'REJECTED';
    const near = await tx.attendancePunch.findFirst({
      where: {
        employeeId: employee.id,
        at: {
          gte: new Date(at.getTime() - DUPLICATE_WINDOW_MS),
          lte: new Date(at.getTime() + DUPLICATE_WINDOW_MS),
        },
      },
      select: { id: true },
    });
    if (near) return 'DUPLICATE';
    try {
      await this.attendance.addDevicePunch(tx, employee, at, now);
      return 'IMPORTED';
    } catch (error) {
      if (error instanceof AppError) return 'REJECTED';
      throw error;
    }
  }

  /** After a user number is linked to an employee, turns the scans that were waiting for it into attendance. */
  async applyPending(
    tx: TenantTransaction,
    code: string,
    employeeId: string,
    now = new Date(),
  ): Promise<number> {
    const employee = await tx.employee.findUnique({
      where: { id: employeeId },
      select: ATTENDANCE_EMPLOYEE_SELECT,
    });
    if (!employee) return 0;
    const waiting = await tx.biometricLog.findMany({
      where: { outcome: 'UNMAPPED', deviceCode: code },
      orderBy: { punchedAt: 'asc' },
      take: 5_000,
      select: { id: true, punchedAt: true },
    });
    let imported = 0;
    for (const log of waiting) {
      const outcome = await this.place(tx, employee, log.punchedAt, now);
      await tx.biometricLog.update({ where: { id: log.id }, data: { outcome, employeeId } });
      if (outcome === 'IMPORTED') imported += 1;
    }
    return imported;
  }
}
