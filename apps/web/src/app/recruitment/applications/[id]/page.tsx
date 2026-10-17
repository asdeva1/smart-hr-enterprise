'use client';

import { useParams } from 'next/navigation';
import { RecruitmentPage } from '../../recruitment-page';
import { ApplicationDetail } from './application-detail';

export default function ApplicationPage() {
  const { id } = useParams<{ id: string }>();
  return <RecruitmentPage>{(session) => <ApplicationDetail id={id} session={session} />}</RecruitmentPage>;
}
