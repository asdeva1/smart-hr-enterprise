'use client';

import { AttendancePage } from '../attendance-page';
import { OvertimeAdmin } from './overtime-admin';

export default function OvertimeAdminPage() {
  return (
    <AttendancePage permission="attendance.manage" feature="attendance.advanced">
      {(session) => <OvertimeAdmin session={session} />}
    </AttendancePage>
  );
}
