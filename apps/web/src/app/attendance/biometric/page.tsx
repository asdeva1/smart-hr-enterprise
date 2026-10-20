'use client';

import { AttendancePage } from '../attendance-page';
import { BiometricAdmin } from './biometric-admin';

export default function BiometricPage() {
  return (
    <AttendancePage permission="attendance.configure">
      {(session) => <BiometricAdmin session={session} />}
    </AttendancePage>
  );
}
