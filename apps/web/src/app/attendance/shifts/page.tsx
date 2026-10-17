'use client';

import { AttendancePage } from '../attendance-page';
import { ShiftsAdmin } from './shifts-admin';

export default function ShiftsPage() {
  return <AttendancePage>{(session) => <ShiftsAdmin session={session} />}</AttendancePage>;
}
