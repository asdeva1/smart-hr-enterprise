/**
 * Biometric machines through the real API and database: registering a machine, the eSSL/ZKTeco push
 * protocol it speaks (handshake, scan upload, polling), scans turning into attendance in the machine's
 * time zone, scans from unlinked user numbers waiting until linked, duplicates and retries, and who may
 * set any of it up.
 */
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addDays, localDate, weekday } from '../src/attendance/attendance-calc.js';
import { parseAttlog } from '../src/attendance/biometric-ingest.service.js';
import { syncPlanCatalogue } from '../src/entitlements/catalogue-sync.js';
import { Browser, Fixtures, ownerClient, startApp, testEnv } from './helpers.js';

const db = ownerClient();
const fx = new Fixtures(db);
let app: NestExpressApplication;
let tenantId: string;
let owner: Browser;
let member: Browser;
let employeeId: string;

const SERIAL = `ESSL${fx.run.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10)}`;
const today = localDate(new Date(), 'Asia/Kolkata');
/** The most recent Wednesday before today: a working day on the default Sunday-off shift. */
const wednesday = (() => {
  let d = addDays(today, -1);
  while (weekday(d) !== 3) d = addDays(d, -1);
  return d;
})();

const server = () => app.getHttpServer() as Parameters<typeof request>[0];
const scan = (code: string, time: string) => `${code}\t${wednesday} ${time}\t0\t1\t0\t0\t0\n`;

async function upload(body: string, serial = SERIAL) {
  return request(server())
    .post(`/iclock/cdata?SN=${serial}&table=ATTLOG&Stamp=9999`)
    .set('content-type', 'text/plain')
    .send(body);
}

async function day(): Promise<{ status: string; workedMinutes: number; firstIn: string | null; lastOut: string | null } | undefined> {
  const res = await owner.send('get', `/v1/attendance/employees/${employeeId}/days?from=${wednesday}&to=${wednesday}`);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return (res.body.days as { date: string }[]).find((d) => d.date === wednesday) as never;
}

beforeAll(async () => {
  await syncPlanCatalogue(db);
  app = await startApp(testEnv());
  const tenant = await fx.tenant('Biometric');
  tenantId = tenant.id;
  const ownerUser = await fx.user('bio-owner');
  await fx.member(tenantId, ownerUser.id, true);
  owner = new Browser(app);
  expect((await owner.login(ownerUser.email)).status).toBe(200);
  const memberUser = await fx.user('bio-member');
  await fx.member(tenantId, memberUser.id);
  member = new Browser(app);
  expect((await member.login(memberUser.email)).status).toBe(200);
  const company = await fx.company(tenantId, 'ACME');
  const res = await owner.send('post', '/v1/employees', {
    firstName: 'Bio',
    lastName: 'Tester',
    companyId: company.id,
    dateOfJoining: '2025-01-01',
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  employeeId = res.body.id as string;
});

afterAll(async () => {
  await fx.cleanup();
  await db.$disconnect();
  await app.close();
});

describe('reading scan lines', () => {
  it('reads tab and space separated lines in the machine’s time zone and skips junk', () => {
    const scans = parseAttlog(
      ['12\t2026-10-14 09:05:30\t0\t1\t0', '7 2026-10-14 08:59:00 1 15', 'garbage', '5\t2026-13-45 99:99:99\t0'].join('\n'),
      'Asia/Kolkata',
    );
    expect(scans.map((s) => s.code)).toEqual(['7', '12']);
    expect(scans[0]?.at.toISOString()).toBe('2026-10-14T03:29:00.000Z');
    expect(scans[1]?.rawStatus).toBe(0);
    expect(scans[1]?.verifyMode).toBe(1);
  });
});

describe('setting up machines', () => {
  it('needs the configure permission', async () => {
    const res = await member.send('post', '/v1/attendance/biometric/devices', { name: 'Gate', serialNumber: SERIAL });
    expect(res.status).toBe(403);
  });

  it('registers a machine once and rejects a bad serial or a repeat', async () => {
    expect((await owner.send('post', '/v1/attendance/biometric/devices', { name: 'Gate', serialNumber: 'a b' })).status).toBe(400);
    const created = await owner.send('post', '/v1/attendance/biometric/devices', {
      name: 'Front gate',
      serialNumber: SERIAL,
      location: 'Reception',
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const again = await owner.send('post', '/v1/attendance/biometric/devices', { name: 'Other', serialNumber: SERIAL });
    expect(again.status).toBe(409);
    const list = await owner.send('get', '/v1/attendance/biometric/devices');
    expect(list.body.devices).toHaveLength(1);
    expect(list.body.devices[0]).toMatchObject({ serialNumber: SERIAL, timeZone: 'Asia/Kolkata', status: 'ACTIVE' });
  });
});

describe('the machine’s side', () => {
  it('ignores machines nobody registered', async () => {
    expect((await request(server()).get('/iclock/cdata?SN=NOTREAL123&options=all')).status).toBe(404);
    expect((await upload(scan('1', '09:00:00'), 'NOTREAL123')).status).toBe(404);
  });

  it('answers the start-up handshake with plain text settings', async () => {
    const res = await request(server()).get(`/iclock/cdata?SN=${SERIAL}&options=all&pushver=2.4.1`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/plain');
    expect(res.text).toContain(`GET OPTION FROM: ${SERIAL}`);
    expect(res.text).toContain('TransFlag=TransData AttLog');
    expect((await request(server()).get(`/iclock/getrequest?SN=${SERIAL}`)).text).toBe('OK');
    expect((await request(server()).post(`/iclock/devicecmd?SN=${SERIAL}`).send('ID=1&Return=0')).text).toBe('OK');
  });

  it('keeps scans from unlinked user numbers until they are linked, then makes attendance of them', async () => {
    const res = await upload(scan('42', '09:02:00') + scan('42', '18:10:00'));
    expect(res.status).toBe(200);
    expect(res.text).toBe('OK: 2');
    const links = await owner.send('get', '/v1/attendance/biometric/links');
    expect(links.body.unlinked).toMatchObject([{ deviceCode: '42', scans: 2 }]);

    const link = await owner.send('post', '/v1/attendance/biometric/links', { employeeId, deviceCode: '42' });
    expect(link.status, JSON.stringify(link.body)).toBe(201);
    expect(link.body.imported).toBe(2);

    const d = await day();
    expect(d?.status).toBe('PRESENT');
    expect(d?.firstIn).toBe(new Date(`${wednesday}T09:02:00+05:30`).toISOString());
    expect(d?.lastOut).toBe(new Date(`${wednesday}T18:10:00+05:30`).toISOString());
    const after = await owner.send('get', '/v1/attendance/biometric/links');
    expect(after.body.unlinked).toEqual([]);
    expect(after.body.links[0]).toMatchObject({ deviceCode: '42', employee: { id: employeeId } });
  });

  it('takes a resent upload without doubling anything', async () => {
    const res = await upload(scan('42', '09:02:00') + scan('42', '18:10:00'));
    expect(res.text).toBe('OK: 2');
    const punches = await db.attendancePunch.count({ where: { employeeId } });
    expect(punches).toBe(2);
    const logs = await db.biometricLog.count({ where: { tenantId } });
    expect(logs).toBe(2);
  });

  it('counts a second touch within a minute once, and alternates in and out', async () => {
    const nextDay = addDays(wednesday, -1);
    const lines = [
      `42\t${nextDay} 09:00:00\t0\t1`,
      `42\t${nextDay} 09:00:20\t0\t1`,
      `42\t${nextDay} 13:00:00\t0\t1`,
      `42\t${nextDay} 14:00:00\t0\t1`,
      `42\t${nextDay} 18:30:00\t0\t1`,
    ].join('\n');
    expect((await upload(lines)).text).toBe('OK: 5');
    const punches = await db.attendancePunch.findMany({
      where: { employeeId, source: 'DEVICE', at: { gte: new Date(`${nextDay}T00:00:00+05:30`), lt: new Date(`${wednesday}T00:00:00+05:30`) } },
      orderBy: { at: 'asc' },
      select: { direction: true },
    });
    expect(punches.map((p) => p.direction)).toEqual(['IN', 'OUT', 'IN', 'OUT']);
    const dup = await db.biometricLog.count({ where: { tenantId, outcome: 'DUPLICATE' } });
    expect(dup).toBe(1);
  });

  it('shows what the machines sent, and can filter it', async () => {
    const all = await owner.send('get', '/v1/attendance/biometric/logs');
    expect(all.status).toBe(200);
    expect(all.body.logs.length).toBeGreaterThanOrEqual(7);
    expect(all.body.logs[0]).toMatchObject({ device: 'Front gate', deviceCode: '42', employee: 'Bio Tester' });
    const dupes = await owner.send('get', '/v1/attendance/biometric/logs?outcome=DUPLICATE');
    expect(dupes.body.logs).toHaveLength(1);
  });

  it('stops listening to an archived machine', async () => {
    const list = await owner.send('get', '/v1/attendance/biometric/devices');
    const id = list.body.devices[0].id as string;
    expect((await owner.send('patch', `/v1/attendance/biometric/devices/${id}`, { status: 'ARCHIVED' })).status).toBe(200);
    expect((await upload(scan('42', '10:00:00'))).status).toBe(404);
  });

  it('removes a link', async () => {
    const links = await owner.send('get', '/v1/attendance/biometric/links');
    const id = links.body.links[0].id as string;
    expect((await owner.send('delete', `/v1/attendance/biometric/links/${id}`)).status).toBe(200);
    expect((await owner.send('get', '/v1/attendance/biometric/links')).body.links).toEqual([]);
  });
});
