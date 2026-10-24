'use client';

import { AttendancePage } from '../attendance-page';
import { RosterAdmin } from './roster-admin';

export default function RosterAdminPage() {
  return (
    <AttendancePage permission="attendance.manage" feature="attendance.advanced">
      {(session) => <RosterAdmin session={session} />}
    </AttendancePage>
  );
}
