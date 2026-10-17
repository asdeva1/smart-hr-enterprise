'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, X } from 'lucide-react';
import { useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { errorMessage } from '@/lib/admin';
import { apiFetch } from '@/lib/api';
import { documentKeys, type EmployeeDocument, type SignatureRequest } from '@/lib/documents';

interface Person {
  membershipId: string;
  name: string;
  email: string;
}

/** Sends a PDF document for signature to one or more members, in order or all at once. */
export function SendDialog({
  document,
  defaultSigner,
  onClose,
  onDone,
}: {
  document: EmployeeDocument;
  defaultSigner?: Person | null;
  onClose: () => void;
  onDone: (r: SignatureRequest) => void;
}) {
  const client = useQueryClient();
  const [signers, setSigners] = useState<Person[]>(defaultSigner ? [defaultSigner] : []);
  const [search, setSearch] = useState('');
  const [sequential, setSequential] = useState(true);
  const [deadline, setDeadline] = useState('14');
  const [message, setMessage] = useState('');
  const people = useQuery({
    queryKey: ['documents', 'people', search],
    queryFn: () => apiFetch<Person[]>(`/v1/signatures/people?search=${encodeURIComponent(search)}`),
    enabled: search.trim().length >= 2,
  });
  const send = useMutation({
    mutationFn: () =>
      apiFetch<SignatureRequest>(`/v1/documents/${document.id}/signatures`, {
        method: 'POST',
        body: {
          signerMembershipIds: signers.map((s) => s.membershipId),
          sequential,
          expiresInDays: deadline ? Number(deadline) : null,
          message,
        },
      }),
    onSuccess: async (r) => {
      await client.invalidateQueries({ queryKey: documentKeys.all });
      onDone(r);
    },
  });
  const move = (i: number, by: number) =>
    setSigners((list) => {
      const next = [...list];
      const [item] = next.splice(i, 1);
      next.splice(i + by, 0, item!);
      return next;
    });

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Send “${document.title}” for signature`}
      description="Each signer is told by notification and email, signs in, reads the document and types their name. The signed copy gets a signature certificate."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={signers.length === 0 || send.isPending} onClick={() => send.mutate()}>
            Send for signature
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {send.isError && <Alert tone="error">{errorMessage(send.error)}</Alert>}
        <section aria-label="Signers" className="flex flex-col gap-2">
          <p className="text-[13px] font-medium">Signers{sequential ? ', in this order' : ''}</p>
          {signers.length === 0 && (
            <p className="text-[13px] text-muted-foreground">Add at least one signer.</p>
          )}
          <ol className="flex flex-col gap-1.5">
            {signers.map((s, i) => (
              <li
                key={s.membershipId}
                className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm"
              >
                <span className="w-5 text-muted-foreground tabular-nums">{i + 1}.</span>
                <span className="min-w-0 flex-1">
                  {s.name} <span className="text-muted-foreground">· {s.email}</span>
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Move ${s.name} up`}
                  disabled={i === 0}
                  onClick={() => move(i, -1)}
                >
                  <ArrowUp className="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Move ${s.name} down`}
                  disabled={i === signers.length - 1}
                  onClick={() => move(i, 1)}
                >
                  <ArrowDown className="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Remove ${s.name}`}
                  onClick={() => setSigners((list) => list.filter((x) => x.membershipId !== s.membershipId))}
                >
                  <X className="size-4" />
                </Button>
              </li>
            ))}
          </ol>
          <Field id="signer-search" label="Add a signer" hint="Search by name or email.">
            <Input id="signer-search" value={search} onChange={(e) => setSearch(e.target.value)} />
          </Field>
          {people.data && (
            <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
              {people.data
                .filter((p) => !signers.some((s) => s.membershipId === p.membershipId))
                .map((p) => (
                  <li
                    key={p.membershipId}
                    className="flex items-center justify-between gap-2 px-3 py-1.5 text-sm"
                  >
                    <span>
                      {p.name} <span className="text-muted-foreground">· {p.email}</span>
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setSigners((list) => [...list, p]);
                        setSearch('');
                      }}
                    >
                      Add
                    </Button>
                  </li>
                ))}
            </ul>
          )}
        </section>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={sequential} onChange={(e) => setSequential(e.target.checked)} />
          Sign one after another, in order
        </label>
        <Field id="sig-deadline" label="Deadline">
          <Select id="sig-deadline" value={deadline} onChange={(e) => setDeadline(e.target.value)}>
            <option value="7">7 days</option>
            <option value="14">14 days</option>
            <option value="30">30 days</option>
            <option value="">No deadline</option>
          </Select>
        </Field>
        <Field id="sig-message" label="Message (optional)">
          <Input id="sig-message" value={message} onChange={(e) => setMessage(e.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
}
