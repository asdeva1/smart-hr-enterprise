'use client';

import { useParams, useSearchParams } from 'next/navigation';
import { LeavePage } from '../../leave-page';
import { EmployeeBalance } from './employee-balance';

export default function EmployeeBalancePage() {
  const { id } = useParams<{ id: string }>();
  const params = useSearchParams();
  const year = Number(params.get('year')) || new Date().getFullYear();
  return <LeavePage>{() => <EmployeeBalance id={id} year={year} />}</LeavePage>;
}
