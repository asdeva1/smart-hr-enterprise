'use client';

import { LeavePage } from '../leave-page';
import { TeamLeave } from './team-leave';

export default function LeaveTeamPage() {
  return <LeavePage>{(session) => <TeamLeave session={session} />}</LeavePage>;
}
