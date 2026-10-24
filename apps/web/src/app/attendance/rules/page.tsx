'use client';

import { AttendancePage } from '../attendance-page';
import { RulesAdmin } from './rules-admin';

export default function RulesAdminPage() {
  return (
    <AttendancePage permission="attendance.configure" feature="attendance.advanced">
      {(session) => <RulesAdmin session={session} />}
    </AttendancePage>
  );
}
