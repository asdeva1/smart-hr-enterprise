'use client';

import { EMPLOYEE_IMPORT_COLUMNS, MAX_IMPORT_ROWS, REQUIRED_IMPORT_COLUMNS } from '@smart-hr/validation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { Table, Td, Th } from '@/components/ui/table';
import { errorMessage } from '@/lib/admin';
import { apiFetch } from '@/lib/api';
import { employeeKeys, IMPORT_TEMPLATE } from '@/lib/employees';

interface ImportResult {
  dryRun: boolean;
  rows: number;
  created: number;
  problems: { row: number; column: string | null; message: string }[];
  problemCount: number;
}

function downloadTemplate() {
  const url = URL.createObjectURL(new Blob([IMPORT_TEMPLATE], { type: 'text/csv' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = 'employees-template.csv';
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function EmployeeImport() {
  const router = useRouter();
  const client = useQueryClient();
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string>();
  const run = useMutation({
    mutationFn: (dryRun: boolean) =>
      apiFetch<ImportResult>('/v1/employees/import', { method: 'POST', body: { csv: file!.text, dryRun } }),
    onSuccess: async (r) => {
      setResult(r);
      if (!r.dryRun && r.created > 0) {
        await client.invalidateQueries({ queryKey: employeeKeys.all });
        router.push(`/employees?imported=${r.created}`);
      }
    },
    onError: (e) => setError(errorMessage(e)),
  });
  const ready = result?.dryRun && result.problemCount === 0 && result.rows > 0;

  return (
    <>
      <nav aria-label="Breadcrumb" className="text-[13px]">
        <Link href="/employees" className="text-primary hover:underline">
          Employees
        </Link>{' '}
        <span className="text-muted-foreground">/ Import</span>
      </nav>
      <PageHeader
        title="Import employees"
        description={`Add up to ${MAX_IMPORT_ROWS.toLocaleString('en-IN')} employees from a spreadsheet saved as CSV. Nothing is added until every row checks out.`}
      />
      <ol className="flex flex-col gap-4">
        <li className="flex flex-col gap-2 rounded-lg border border-border bg-card p-5">
          <h2 className="font-semibold">1. Fill in the template</h2>
          <p className="max-w-prose text-[13px] text-muted-foreground">
            Required columns: {REQUIRED_IMPORT_COLUMNS.join(', ')}. Companies, branches, departments,
            designations, grades and managers are matched by their codes. Leave employee_code empty to number
            people automatically. Dates are YYYY-MM-DD.
          </p>
          <div>
            <Button variant="outline" size="sm" onClick={downloadTemplate}>
              Download template
            </Button>
          </div>
        </li>
        <li className="flex flex-col gap-3 rounded-lg border border-border bg-card p-5">
          <h2 className="font-semibold">2. Choose the file and check it</h2>
          <label className="flex flex-col gap-1.5 text-[13px] font-medium">
            CSV file
            <input
              type="file"
              accept=".csv,text/csv"
              className="text-sm file:mr-3 file:rounded-md file:border file:border-input file:bg-card file:px-3 file:py-1.5 file:text-sm"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                setResult(null);
                setError(undefined);
                setFile(f ? { name: f.name, text: await f.text() } : null);
              }}
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <Button disabled={!file || run.isPending} onClick={() => run.mutate(true)}>
              {run.isPending && run.variables ? 'Checking…' : 'Check file'}
            </Button>
            {ready && (
              <Button disabled={run.isPending} onClick={() => run.mutate(false)}>
                Import {result.rows} {result.rows === 1 ? 'employee' : 'employees'}
              </Button>
            )}
          </div>
          {error && <Alert tone="error">{error}</Alert>}
          {ready && <Alert tone="success">All {result.rows} rows are ready to import.</Alert>}
          {result && result.problemCount > 0 && (
            <>
              <Alert tone="error">
                {result.problemCount} {result.problemCount === 1 ? 'problem' : 'problems'} to fix. Correct the
                file and check it again; nothing has been imported.
              </Alert>
              <Table label="Problems">
                <thead>
                  <tr>
                    <Th>Row</Th>
                    <Th>Column</Th>
                    <Th>Problem</Th>
                  </tr>
                </thead>
                <tbody>
                  {result.problems.map((p, i) => (
                    <tr key={i}>
                      <Td className="tabular-nums">{p.row}</Td>
                      <Td className="font-mono text-[13px]">{p.column ?? '—'}</Td>
                      <Td>{p.message}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </>
          )}
        </li>
      </ol>
      <details className="text-[13px] text-muted-foreground">
        <summary className="cursor-pointer">All columns</summary>
        <p className="mt-2 font-mono">{EMPLOYEE_IMPORT_COLUMNS.join(', ')}</p>
      </details>
    </>
  );
}
