'use client';

import { useParams } from 'next/navigation';
import { RecruitmentPage } from '../../recruitment-page';
import { OpeningDetail } from './opening-detail';

export default function OpeningPage() {
  const { id } = useParams<{ id: string }>();
  return <RecruitmentPage>{() => <OpeningDetail id={id} />}</RecruitmentPage>;
}
