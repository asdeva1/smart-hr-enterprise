'use client';

import Link from 'next/link';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { EmptyState, Loading, PageHeader } from '@/components/ui/page-header';
import { Table, Td, Th } from '@/components/ui/table';
import { errorMessage } from '@/lib/admin';
import { useMyInterviews, when } from '@/lib/recruitment';
import { RecruitmentPage, RecruitmentTabs } from '../recruitment-page';

export default function MyInterviewsPage() {
  const interviews = useMyInterviews();
  return (
    <RecruitmentPage>
      {() => (
        <>
          <PageHeader
            title="Recruitment"
            description="Interviews you are on, and the feedback you still owe."
          />
          <RecruitmentTabs active="/recruitment/interviews" />
          {interviews.isPending ? (
            <Loading />
          ) : interviews.isError ? (
            <Alert tone="error">{errorMessage(interviews.error)}</Alert>
          ) : interviews.data.length === 0 ? (
            <EmptyState title="No interviews">
              When a recruiter adds you to an interview, it shows here.
            </EmptyState>
          ) : (
            <Table label="My interviews">
              <thead>
                <tr>
                  <Th>Candidate</Th>
                  <Th>Opening</Th>
                  <Th>When</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody>
                {interviews.data.map((i) => (
                  <tr key={i.interviewId}>
                    <Td>
                      <Link
                        href={`/recruitment/applications/${i.applicationId}`}
                        className="font-medium text-primary hover:underline"
                      >
                        {i.candidate}
                      </Link>
                      <span className="block text-xs text-muted-foreground">{i.title}</span>
                    </Td>
                    <Td>{i.opening.title}</Td>
                    <Td>
                      {when(i.scheduledAt)}
                      {i.location && (
                        <span className="block text-xs text-muted-foreground">{i.location}</span>
                      )}
                    </Td>
                    <Td>
                      {i.feedbackDue ? (
                        <Badge tone="warning">Feedback due</Badge>
                      ) : i.status === 'CANCELLED' ? (
                        <Badge>Cancelled</Badge>
                      ) : (
                        <Badge tone="success">Feedback given</Badge>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </>
      )}
    </RecruitmentPage>
  );
}
