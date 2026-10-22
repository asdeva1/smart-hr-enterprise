import type { Metadata } from 'next';
import { DemoForm } from '@/components/demo-form';

export const metadata: Metadata = { title: 'Try the demo' };

export default function Demo() {
  return (
    <div className="mx-auto grid max-w-6xl gap-12 px-5 pt-16 lg:grid-cols-[1fr_440px]">
      <div>
        <h1 className="text-5xl font-semibold">Try SmartHRMS with your own team.</h1>
        <p className="mt-5 max-w-xl text-lg text-muted">
          Sign up with your company email and we’ll send a link to your private workspace. Nothing to install
          and no card needed.
        </p>
        <ul className="mt-8 max-w-xl space-y-3 border-l-2 border-brand pl-5">
          <li>Employee records, attendance, leave and standard reports</li>
          <li>Up to 5 members and 25 employees</li>
          <li>Free for 14 days, then it simply stops. You’re never billed.</li>
          <li>Upgrade to a paid plan any time and keep what you’ve entered</li>
        </ul>
      </div>
      <div className="h-fit rounded-md border border-line bg-white p-6 sm:p-8">
        <DemoForm />
      </div>
    </div>
  );
}
