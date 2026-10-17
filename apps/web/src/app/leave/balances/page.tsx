'use client';

import { LeavePage } from '../leave-page';
import { Balances } from './balances';

export default function LeaveBalancesPage() {
  return <LeavePage>{(session) => <Balances session={session} />}</LeavePage>;
}
