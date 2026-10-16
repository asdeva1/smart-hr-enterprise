import { Injectable } from '@nestjs/common';
import { normalizeEmail } from '@smart-hr/auth';
import type { TenantTransaction } from '@smart-hr/database';
import { AppError } from '@smart-hr/shared';
import {
  EMPLOYEE_IMPORT_COLUMNS,
  employeeImportRowSchema,
  MAX_IMPORT_ROWS,
  parseCsv,
  REQUIRED_IMPORT_COLUMNS,
  type EmployeeImportColumn,
  type EmployeeImportRow,
} from '@smart-hr/validation';
import { AuditService } from '../audit/audit.service.js';
import type { AuthContext, TenantContext } from '../auth/auth.types.js';
import type { RequestMeta } from '../common/request-context.js';
import { EntitlementsService } from '../entitlements/entitlements.service.js';
import { EmployeesService, toDate, toDateOrNull } from './employees.service.js';
import { OrgIndex } from './org-index.js';

export interface ImportProblem {
  /** Spreadsheet row number (the header is row 1). */
  row: number;
  column: EmployeeImportColumn | null;
  message: string;
}

interface Resolved {
  row: number;
  input: EmployeeImportRow;
  data: {
    employeeCode: string | null;
    companyId: string;
    branchId: string | null;
    departmentId: string | null;
    designationId: string | null;
    gradeId: string | null;
    employmentTypeId: string | null;
    costCentreId: string | null;
  };
  managerCode: string | null;
}

const LOOKUP_COLUMNS = {
  designation_code: 'designation',
  grade_code: 'grade',
  employment_type_code: 'employment_type',
  cost_centre_code: 'cost_centre',
} as const;

/**
 * Bulk import from a spreadsheet saved as CSV. A dry run checks every row and reports every problem without
 * changing anything. A real run re-checks and then creates every employee in one transaction: either all
 * rows are imported or none are. Managers may be existing employees or other rows in the same file.
 */
@Injectable()
export class EmployeeImportService {
  constructor(
    private readonly employees: EmployeesService,
    private readonly entitlements: EntitlementsService,
    private readonly audit: AuditService,
  ) {}

  async run(tenant: TenantContext, auth: AuthContext, csv: string, dryRun: boolean, meta: RequestMeta) {
    let table: string[][];
    try {
      table = parseCsv(csv);
    } catch (error) {
      throw new AppError(
        'CSV_INVALID',
        error instanceof Error ? error.message : 'The file couldn’t be read',
        400,
      );
    }
    if (table.length < 2) throw new AppError('CSV_EMPTY', 'The file has no employee rows', 400);
    if (table.length - 1 > MAX_IMPORT_ROWS) {
      throw new AppError('CSV_TOO_LARGE', `Import at most ${MAX_IMPORT_ROWS} employees at a time`, 400);
    }
    const header = table[0]!.map((h) =>
      h
        .trim()
        .toLowerCase()
        .replace(/[\s-]+/g, '_'),
    );
    const unknown = header.filter((h) => h && !(EMPLOYEE_IMPORT_COLUMNS as readonly string[]).includes(h));
    const missing = REQUIRED_IMPORT_COLUMNS.filter((c) => !header.includes(c));
    if (missing.length || unknown.length) {
      throw new AppError(
        'CSV_COLUMNS',
        [
          missing.length ? `Missing columns: ${missing.join(', ')}.` : '',
          unknown.length ? `Unknown columns: ${unknown.join(', ')}.` : '',
          'Download the template to see the expected columns.',
        ]
          .filter(Boolean)
          .join(' '),
        400,
      );
    }

    return this.employees.run(tenant, auth, async (tx) => {
      const problems: ImportProblem[] = [];
      const resolved = await this.resolve(tx, tenant, header, table.slice(1), problems);
      if (problems.length === 0) {
        try {
          await this.entitlements.assertWithinLimit(tx, 'employees.max', resolved.length);
        } catch (error) {
          if (!(error instanceof AppError)) throw error;
          problems.push({ row: 1, column: null, message: error.message });
        }
      }
      problems.sort((a, b) => a.row - b.row);
      if (dryRun || problems.length > 0) {
        return {
          dryRun: true,
          rows: resolved.length,
          created: 0,
          problems: problems.slice(0, 500),
          problemCount: problems.length,
        };
      }

      // Everything checks out: create in file order, then link managers (some are rows of this file).
      const idByCode = new Map<string, string>();
      const createdIds: string[] = [];
      for (const r of resolved) {
        const employeeCode = r.data.employeeCode ?? (await this.employees.nextCode(tx, tenant.id));
        const created = await tx.employee.create({
          data: {
            tenantId: tenant.id,
            ...r.data,
            employeeCode,
            firstName: r.input.first_name,
            lastName: r.input.last_name,
            workEmail: r.input.work_email ? normalizeEmail(r.input.work_email) : null,
            phone: r.input.phone ?? null,
            gender: r.input.gender ?? null,
            dateOfBirth: toDateOrNull(r.input.date_of_birth) ?? null,
            dateOfJoining: toDate(r.input.date_of_joining),
          },
          select: { id: true },
        });
        idByCode.set(employeeCode, created.id);
        createdIds.push(created.id);
        await this.employees.event(
          tx,
          tenant.id,
          created.id,
          'JOINED',
          toDate(r.input.date_of_joining),
          {},
          'Imported',
          auth.user.id,
        );
      }
      for (const [i, r] of resolved.entries()) {
        if (!r.managerCode) continue;
        const id = createdIds[i];
        const managerId =
          idByCode.get(r.managerCode) ??
          (await tx.employee.findFirst({ where: { employeeCode: r.managerCode }, select: { id: true } }))?.id;
        if (id && managerId) await tx.employee.update({ where: { id }, data: { managerId } });
      }
      await this.audit.recordInTransaction(
        tx,
        {
          action: 'employee.import',
          outcome: 'SUCCESS',
          tenantId: tenant.id,
          actorUserId: auth.user.id,
          targetType: 'employee',
          metadata: { created: resolved.length },
        },
        meta,
      );
      return {
        dryRun: false,
        rows: resolved.length,
        created: resolved.length,
        problems: [],
        problemCount: 0,
      };
    });
  }

  private async resolve(
    tx: TenantTransaction,
    tenant: TenantContext,
    header: string[],
    rows: string[][],
    problems: ImportProblem[],
  ): Promise<Resolved[]> {
    const org = await OrgIndex.load(tx, tenant.id);
    const byCode = <T extends { code: string; status: string }>(m: Map<string, T>) =>
      new Map(
        [...m]
          .filter(([, v]) => v.status === 'ACTIVE')
          .map(([id, v]) => [v.code.toUpperCase(), { id, ...v }]),
      );
    const companies = byCode(org.companies);
    const branches = byCode(org.branches);
    const departments = byCode(org.departments);
    const lookups = await tx.lookupValue.findMany({
      where: { status: 'ACTIVE' },
      select: { id: true, list: true, code: true },
    });
    const lookup = new Map(lookups.map((l) => [`${l.list}:${l.code.toUpperCase()}`, l.id]));
    const existing = await tx.employee.findMany({
      select: { employeeCode: true, workEmail: true, status: true },
    });
    const existingCodes = new Map(existing.map((e) => [e.employeeCode.toUpperCase(), e.status]));
    const existingEmails = new Set(existing.map((e) => e.workEmail).filter(Boolean));

    const seenCodes = new Map<string, number>();
    const seenEmails = new Map<string, number>();
    const out: Resolved[] = [];
    const fileCodes = new Set<string>();

    rows.forEach((cells, i) => {
      const rowNumber = i + 2;
      const raw = Object.fromEntries(header.map((h, j) => [h, (cells[j] ?? '').trim()]));
      const parsed = employeeImportRowSchema.safeParse(raw);
      if (!parsed.success) {
        for (const issue of parsed.error.issues) {
          problems.push({
            row: rowNumber,
            column: issue.path[0] as EmployeeImportColumn,
            message: issue.message,
          });
        }
        return;
      }
      const r = parsed.data;
      const fail = (column: EmployeeImportColumn, message: string) =>
        problems.push({ row: rowNumber, column, message });
      const before = problems.length;

      const company = companies.get(r.company_code);
      if (!company) fail('company_code', `No active company with code ${r.company_code}`);
      const branch = r.branch_code ? branches.get(r.branch_code.toUpperCase()) : null;
      if (r.branch_code && (!branch || branch.companyId !== company?.id)) {
        fail('branch_code', `No active branch ${r.branch_code} in this company`);
      }
      const dept = r.department_code ? departments.get(r.department_code.toUpperCase()) : null;
      if (r.department_code && (!dept || dept.companyId !== company?.id)) {
        fail('department_code', `No active department ${r.department_code} in this company`);
      }
      const lookupIds: Record<string, string | null> = {};
      for (const [column, list] of Object.entries(LOOKUP_COLUMNS) as [
        keyof typeof LOOKUP_COLUMNS,
        string,
      ][]) {
        const code = r[column];
        lookupIds[column] = code ? (lookup.get(`${list}:${code.toUpperCase()}`) ?? null) : null;
        if (code && !lookupIds[column]) fail(column, `${code} isn’t in the ${list.replace('_', ' ')} list`);
      }
      if (r.employee_code) {
        if (existingCodes.has(r.employee_code))
          fail('employee_code', `${r.employee_code} is already an employee`);
        const dup = seenCodes.get(r.employee_code);
        if (dup) fail('employee_code', `Also used on row ${dup}`);
        seenCodes.set(r.employee_code, rowNumber);
        fileCodes.add(r.employee_code);
      }
      if (r.work_email) {
        const email = normalizeEmail(r.work_email);
        if (existingEmails.has(email)) fail('work_email', 'Another employee already uses this work email');
        const dup = seenEmails.get(email);
        if (dup) fail('work_email', `Also used on row ${dup}`);
        seenEmails.set(email, rowNumber);
      }
      if (r.date_of_birth && r.date_of_birth >= r.date_of_joining)
        fail('date_of_birth', 'Must be before the joining date');
      if (
        company &&
        !tenant.permissions.allows(
          'employees.manage',
          org.scopesOf({
            companyId: company.id,
            branchId: branch?.id ?? null,
            departmentId: dept?.id ?? null,
          }),
        )
      ) {
        fail('company_code', 'You can’t add employees here');
      }
      if (problems.length > before || !company) return;
      out.push({
        row: rowNumber,
        input: r,
        data: {
          employeeCode: r.employee_code ?? null,
          companyId: company.id,
          branchId: branch?.id ?? null,
          departmentId: dept?.id ?? null,
          designationId: lookupIds.designation_code ?? null,
          gradeId: lookupIds.grade_code ?? null,
          employmentTypeId: lookupIds.employment_type_code ?? null,
          costCentreId: lookupIds.cost_centre_code ?? null,
        },
        managerCode: r.manager_code ? r.manager_code.toUpperCase() : null,
      });
    });

    // Managers: an existing current employee, or another row of this file that has a code.
    for (const r of out) {
      if (!r.managerCode) continue;
      if (r.managerCode === r.data.employeeCode) {
        problems.push({ row: r.row, column: 'manager_code', message: 'An employee can’t manage themself' });
      } else if (!fileCodes.has(r.managerCode)) {
        const status = existingCodes.get(r.managerCode);
        if (!status || status === 'EXITED') {
          problems.push({
            row: r.row,
            column: 'manager_code',
            message: `No current employee with code ${r.managerCode}`,
          });
        }
      }
    }
    // Reporting loops inside the file (A → B → A).
    const managerOf = new Map(
      out.filter((r) => r.data.employeeCode).map((r) => [r.data.employeeCode!, r.managerCode]),
    );
    for (const r of out) {
      if (!r.data.employeeCode) continue;
      let current = r.managerCode;
      for (let depth = 0; current && depth < MAX_IMPORT_ROWS; depth++) {
        if (current === r.data.employeeCode) {
          problems.push({ row: r.row, column: 'manager_code', message: 'These managers form a loop' });
          break;
        }
        current = managerOf.get(current) ?? null;
      }
    }
    return out;
  }
}
