'use client';

import { LeavePage } from './leave-page';
import { MyLeave } from './my-leave';

export default function LeaveHome() {
  return <LeavePage>{(session) => <MyLeave session={session} />}</LeavePage>;
}
