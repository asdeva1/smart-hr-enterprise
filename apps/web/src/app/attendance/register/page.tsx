'use client';

import { AttendancePage } from '../attendance-page';
import { AttendanceRegister } from './register';

export default function AttendanceRegisterPage() {
  return <AttendancePage>{(session) => <AttendanceRegister session={session} />}</AttendancePage>;
}
