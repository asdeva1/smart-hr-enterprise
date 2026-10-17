'use client';

import { useParams } from 'next/navigation';
import { AttendancePage } from '../../attendance-page';
import { CorrectionDetail } from './correction-detail';

export default function CorrectionPage() {
  const { id } = useParams<{ id: string }>();
  return <AttendancePage>{() => <CorrectionDetail id={id} />}</AttendancePage>;
}
