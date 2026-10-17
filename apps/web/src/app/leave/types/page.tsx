'use client';

import { LeavePage } from '../leave-page';
import { LeaveTypes } from './leave-types';

export default function LeaveTypesPage() {
  return <LeavePage permission="leave.configure">{(session) => <LeaveTypes session={session} />}</LeavePage>;
}
