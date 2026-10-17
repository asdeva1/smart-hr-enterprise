'use client';

import { AttendancePage } from '../attendance-page';
import { TeamAttendance } from './team-day';

export default function TeamAttendancePage() {
  return <AttendancePage>{(session) => <TeamAttendance session={session} />}</AttendancePage>;
}
