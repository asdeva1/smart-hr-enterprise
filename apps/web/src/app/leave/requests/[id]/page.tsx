'use client';

import { useParams } from 'next/navigation';
import { LeavePage } from '../../leave-page';
import { RequestDetail } from './request-detail';

export default function LeaveRequestPage() {
  const { id } = useParams<{ id: string }>();
  return <LeavePage>{() => <RequestDetail id={id} />}</LeavePage>;
}
