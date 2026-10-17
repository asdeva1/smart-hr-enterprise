'use client';

import { useParams } from 'next/navigation';
import { DocumentsPage } from '../../documents-page';
import { SignatureDetail } from './signature-detail';

export default function SignaturePage() {
  const { id } = useParams<{ id: string }>();
  return <DocumentsPage>{(session) => <SignatureDetail id={id} session={session} />}</DocumentsPage>;
}
