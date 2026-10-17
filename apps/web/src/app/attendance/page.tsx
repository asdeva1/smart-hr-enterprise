'use client';

import { AttendancePage } from './attendance-page';
import { MyAttendance } from './my-attendance';

export default function AttendanceHome() {
  return <AttendancePage>{(session) => <MyAttendance session={session} />}</AttendancePage>;
}
