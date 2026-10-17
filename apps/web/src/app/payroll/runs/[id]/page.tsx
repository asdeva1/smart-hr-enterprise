'use client';

import { useParams } from 'next/navigation';
import { PayrollPage } from '../../payroll-page';
import { RunDetail } from './run-detail';

export default function PayrollRunPage() {
  const { id } = useParams<{ id: string }>();
  return <PayrollPage>{(session) => <RunDetail id={id} session={session} />}</PayrollPage>;
}
