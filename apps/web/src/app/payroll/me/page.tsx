'use client';

import { useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { EmptyState, Loading, PageHeader } from '@/components/ui/page-header';
import { Table, Td, Th } from '@/components/ui/table';
import { errorMessage } from '@/lib/admin';
import { downloadFile, rupees, useMyPayslips } from '@/lib/payroll';
import { PayrollPage, PayrollTabs } from '../payroll-page';

export default function MyPayslipsPage() {
  const mine = useMyPayslips();
  const [error, setError] = useState<string>();
  return (
    <PayrollPage>
      {(session) => (
        <>
          <PageHeader title="Payroll" description="Your payslips, once each month’s payroll is approved." />
          <PayrollTabs session={session} active="/payroll/me" />
          {error && <Alert tone="error">{error}</Alert>}
          {mine.isPending ? (
            <Loading />
          ) : mine.isError ? (
            <Alert tone="error">{errorMessage(mine.error)}</Alert>
          ) : !mine.data.employee ? (
            <EmptyState title="Your account isn’t linked to an employee record">
              Ask HR to link it.
            </EmptyState>
          ) : mine.data.payslips.length === 0 ? (
            <EmptyState title="No payslips yet">
              They appear here once a month’s payroll is approved.
            </EmptyState>
          ) : (
            <Table label="My payslips">
              <thead>
                <tr>
                  <Th>Month</Th>
                  <Th className="text-right">Gross</Th>
                  <Th className="text-right">Net pay</Th>
                  <Th className="text-right">Payslip</Th>
                </tr>
              </thead>
              <tbody>
                {mine.data.payslips.map((p) => (
                  <tr key={p.id}>
                    <Td className="font-medium">{p.period}</Td>
                    <Td className="text-right tabular-nums">{rupees(p.gross)}</Td>
                    <Td className="text-right tabular-nums">{rupees(p.net)}</Td>
                    <Td className="text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        aria-label={`Download payslip for ${p.period}`}
                        onClick={() =>
                          downloadFile(`/v1/payroll/payslips/${p.id}/pdf`).catch((e: unknown) =>
                            setError(errorMessage(e)),
                          )
                        }
                      >
                        Download PDF
                      </Button>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </>
      )}
    </PayrollPage>
  );
}
