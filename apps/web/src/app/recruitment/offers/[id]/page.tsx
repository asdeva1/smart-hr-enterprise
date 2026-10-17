'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Alert } from '@/components/ui/alert';
import { Loading, PageHeader } from '@/components/ui/page-header';
import { errorMessage } from '@/lib/admin';
import { apiFetch } from '@/lib/api';
import { formatDay } from '@/lib/employees';
import { money, OFFER_STATUS_LABEL, recruitmentKeys, type OfferStatus } from '@/lib/recruitment';
import { RecruitmentPage } from '../../recruitment-page';

interface Offer {
  id: string;
  status: OfferStatus;
  applicationId: string;
  candidate: { name: string; email: string };
  opening: { id: string; code: string; title: string };
  designation: string | null;
  joiningDate: string;
  annualCtc: number | null;
  currency: string | null;
  notes: string | null;
  approvalRequestId: string | null;
}

/** An offer, as its approvers see it. They decide on it from Approvals. */
export default function OfferPage() {
  const { id } = useParams<{ id: string }>();
  const offer = useQuery({
    queryKey: recruitmentKeys.offer(id),
    queryFn: () => apiFetch<Offer>(`/v1/recruitment/offers/${id}`),
  });
  return (
    <RecruitmentPage>
      {() =>
        offer.isPending ? (
          <Loading />
        ) : offer.isError ? (
          <Alert tone="error">{errorMessage(offer.error)}</Alert>
        ) : (
          <>
            <PageHeader
              title={`Offer: ${offer.data.candidate.name}`}
              description={`${offer.data.opening.title} (${offer.data.opening.code})`}
            />
            <dl className="grid max-w-xl grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
              <dt className="text-muted-foreground">Status</dt>
              <dd>{OFFER_STATUS_LABEL[offer.data.status]}</dd>
              <dt className="text-muted-foreground">Designation</dt>
              <dd>{offer.data.designation ?? '—'}</dd>
              <dt className="text-muted-foreground">Joining</dt>
              <dd>{formatDay(offer.data.joiningDate)}</dd>
              <dt className="text-muted-foreground">Annual CTC</dt>
              <dd>{money(offer.data.annualCtc, offer.data.currency)}</dd>
              <dt className="text-muted-foreground">Notes</dt>
              <dd>{offer.data.notes ?? '—'}</dd>
            </dl>
            <p className="text-sm">
              {offer.data.approvalRequestId && (
                <Link
                  href={`/approvals/${offer.data.approvalRequestId}`}
                  className="text-primary hover:underline"
                >
                  Open the approval
                </Link>
              )}
            </p>
          </>
        )
      }
    </RecruitmentPage>
  );
}
