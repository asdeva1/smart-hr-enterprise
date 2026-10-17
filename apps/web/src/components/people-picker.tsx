'use client';

import { useQuery } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { useState } from 'react';
import { apiFetch } from '@/lib/api';
import { Button } from './ui/button';
import { Field } from './ui/field';
import { Input } from './ui/input';

export interface PersonOption {
  membershipId: string;
  name: string;
  email: string;
}

/** Chooses several active members by name or email, from an API search endpoint. */
export function PeoplePicker({
  id,
  label,
  endpoint,
  value,
  onChange,
}: {
  id: string;
  label: string;
  /** Returns PersonOption[] for `?search=`. */
  endpoint: string;
  value: PersonOption[];
  onChange: (people: PersonOption[]) => void;
}) {
  const [search, setSearch] = useState('');
  const people = useQuery({
    queryKey: ['people', endpoint, search],
    queryFn: () => apiFetch<PersonOption[]>(`${endpoint}?search=${encodeURIComponent(search)}`),
    enabled: search.trim().length >= 2,
  });
  return (
    <div className="flex flex-col gap-2">
      {value.length > 0 && (
        <ul aria-label={`${label} chosen`} className="flex flex-wrap gap-1.5">
          {value.map((p) => (
            <li
              key={p.membershipId}
              className="flex items-center gap-1 rounded-full border border-border bg-card py-0.5 pr-1 pl-3 text-[13px]"
            >
              {p.name}
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-1"
                aria-label={`Remove ${p.name}`}
                onClick={() => onChange(value.filter((x) => x.membershipId !== p.membershipId))}
              >
                <X className="size-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <Field id={id} label={label} hint="Search by name or email.">
        <Input id={id} value={search} onChange={(e) => setSearch(e.target.value)} />
      </Field>
      {people.data && (
        <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
          {people.data
            .filter((p) => !value.some((v) => v.membershipId === p.membershipId))
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
                    onChange([...value, p]);
                    setSearch('');
                  }}
                >
                  Add
                </Button>
              </li>
            ))}
        </ul>
      )}
    </div>
  );
}
