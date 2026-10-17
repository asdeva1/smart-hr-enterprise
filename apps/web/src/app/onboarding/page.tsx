'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { EmptyState, Loading, PageHeader } from '@/components/ui/page-header';
import { Table, Td, Th } from '@/components/ui/table';
import { errorMessage } from '@/lib/admin';
import { apiFetch } from '@/lib/api';
import { formatDay, todayIso } from '@/lib/employees';
import { recruitmentKeys, useMyOnboardingTasks } from '@/lib/recruitment';
import { OnboardingPage, OnboardingTabs } from './onboarding-page';

export default function MyTasksPage() {
  const tasks = useMyOnboardingTasks();
  const client = useQueryClient();
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; text: string }>();
  const done = useMutation({
    mutationFn: (taskId: string) =>
      apiFetch(`/v1/onboarding/tasks/${taskId}`, { method: 'POST', body: { status: 'DONE' } }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: recruitmentKeys.onboarding });
      setNotice({ tone: 'success', text: 'Task done.' });
    },
    onError: (e) => setNotice({ tone: 'error', text: errorMessage(e) }),
  });
  const today = todayIso();
  return (
    <OnboardingPage>
      {(session) => (
        <>
          <PageHeader title="Onboarding" description="Tasks for people joining, including you." />
          <OnboardingTabs session={session} active="/onboarding" />
          {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}
          {tasks.isPending ? (
            <Loading />
          ) : tasks.isError ? (
            <Alert tone="error">{errorMessage(tasks.error)}</Alert>
          ) : tasks.data.length === 0 ? (
            <EmptyState title="Nothing to do">Onboarding tasks given to you show here.</EmptyState>
          ) : (
            <Table label="My onboarding tasks">
              <thead>
                <tr>
                  <Th>Task</Th>
                  <Th>For</Th>
                  <Th>Due</Th>
                  <Th className="text-right">Actions</Th>
                </tr>
              </thead>
              <tbody>
                {tasks.data.map((t) => (
                  <tr key={t.id}>
                    <Td>
                      <span className="font-medium">{t.title}</span>
                      {t.description && (
                        <span className="block text-xs text-muted-foreground">{t.description}</span>
                      )}
                    </Td>
                    <Td>
                      {t.forMe ? (
                        'You'
                      ) : (
                        <Link
                          href={`/employees/${t.employee.id}?tab=onboarding`}
                          className="text-primary hover:underline"
                        >
                          {t.employee.name}
                        </Link>
                      )}
                    </Td>
                    <Td className={t.dueDate < today ? 'font-medium text-danger' : undefined}>
                      {formatDay(t.dueDate)}
                    </Td>
                    <Td className="text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        aria-label={`Mark “${t.title}” done`}
                        disabled={done.isPending}
                        onClick={() => done.mutate(t.id)}
                      >
                        Done
                      </Button>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </>
      )}
    </OnboardingPage>
  );
}
