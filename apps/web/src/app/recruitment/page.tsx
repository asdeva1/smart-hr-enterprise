'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { EmptyState, Loading, PageHeader } from '@/components/ui/page-header';
import { Select } from '@/components/ui/select';
import { Table, Td, Th } from '@/components/ui/table';
import { errorMessage } from '@/lib/admin';
import { can } from '@/lib/permissions';
import { OPENING_STATUS_LABEL, OPENING_STATUS_TONE, useOpenings } from '@/lib/recruitment';
import { OpeningDialog } from './opening-dialog';
import { RecruitmentPage, RecruitmentTabs } from './recruitment-page';

export default function OpeningsPage() {
  const [status, setStatus] = useState('ACTIVE');
  const [creating, setCreating] = useState(false);
  const router = useRouter();
  const openings = useOpenings(status);
  return (
    <RecruitmentPage>
      {(session) => (
        <>
          <PageHeader
            title="Recruitment"
            description="Open positions, the candidates in them, and the interviews you are on."
            actions={
              can(session, 'recruitment.manage') ? (
                <Button onClick={() => setCreating(true)}>New opening</Button>
              ) : null
            }
          />
          <RecruitmentTabs active="/recruitment" />
          <div className="max-w-xs">
            <Field id="opening-status" label="Show">
              <Select id="opening-status" value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="ACTIVE">Current openings</option>
                <option value="OPEN">Open</option>
                <option value="CLOSED">Closed</option>
                <option value="ALL">All</option>
              </Select>
            </Field>
          </div>
          {openings.isPending ? (
            <Loading />
          ) : openings.isError ? (
            <Alert tone="error">{errorMessage(openings.error)}</Alert>
          ) : openings.data.length === 0 ? (
            <EmptyState title="No openings">
              {can(session, 'recruitment.manage')
                ? 'Draft one with New opening; it opens once approved.'
                : null}
            </EmptyState>
          ) : (
            <Table label="Job openings">
              <thead>
                <tr>
                  <Th>Opening</Th>
                  <Th>Where</Th>
                  <Th className="text-right">Candidates</Th>
                  <Th className="text-right">Hired</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody>
                {openings.data.map((o) => (
                  <tr key={o.id}>
                    <Td>
                      <Link
                        href={`/recruitment/openings/${o.id}`}
                        className="font-medium text-primary hover:underline"
                      >
                        {o.title}
                      </Link>
                      <span className="block font-mono text-xs text-muted-foreground">{o.code}</span>
                    </Td>
                    <Td>
                      {[o.company.name, o.branch?.name, o.department?.name].filter(Boolean).join(' · ')}
                    </Td>
                    <Td className="text-right tabular-nums">{o.applications}</Td>
                    <Td className="text-right tabular-nums">
                      {o.hired} / {o.positions}
                    </Td>
                    <Td>
                      <Badge tone={OPENING_STATUS_TONE[o.status]}>{OPENING_STATUS_LABEL[o.status]}</Badge>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
          {creating && (
            <OpeningDialog
              onClose={() => setCreating(false)}
              onDone={(o) => router.push(`/recruitment/openings/${o.id}`)}
            />
          )}
        </>
      )}
    </RecruitmentPage>
  );
}
