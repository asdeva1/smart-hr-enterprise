import type { Metadata } from 'next';
import { ContactForm } from '@/components/contact-form';

export const metadata: Metadata = { title: 'Contact us' };

export default async function Contact({ searchParams }: { searchParams: Promise<{ topic?: string }> }) {
  const { topic } = await searchParams;
  const interest = ['PRICING', 'DEMO', 'DEDICATED', 'OTHER'].includes(topic ?? '') ? topic : 'PRICING';
  return (
    <div className="mx-auto grid max-w-6xl gap-12 px-5 pt-16 lg:grid-cols-[1fr_600px]">
      <div>
        <h1 className="text-5xl font-semibold">Talk to us.</h1>
        <p className="mt-5 max-w-xl text-lg text-muted">
          Tell us a little about your team and what you’d like to see. We reply within one working day, with a
          plan and a quote that fit, or a guided walkthrough of the product.
        </p>
      </div>
      <div className="h-fit rounded-md border border-line bg-white p-6 sm:p-8">
        <ContactForm defaultInterest={interest} />
      </div>
    </div>
  );
}
