'use client';

import { useQuery } from '@tanstack/react-query';
import { useDeferredValue, useId, useState } from 'react';
import { apiFetch } from '@/lib/api';
import type { EmployeeListItem } from '@/lib/employees';
import { cn } from '@/lib/utils';
import { Input } from '../ui/input';

/**
 * Chooses one current employee by typing part of a name or number. Used for managers. Only people the
 * member can see are offered; the API checks the choice again.
 */
export function EmployeePicker({
  id,
  value,
  onChange,
  exclude,
  invalid,
  describedBy,
}: {
  id: string;
  value: { id: string; name: string } | null;
  onChange: (value: { id: string; name: string } | null) => void;
  exclude?: string;
  invalid?: boolean;
  describedBy?: string;
}) {
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const term = useDeferredValue(text.trim());
  const listId = useId();
  const results = useQuery({
    queryKey: ['employees', 'picker', term],
    queryFn: () =>
      apiFetch<{ items: EmployeeListItem[] }>(
        `/v1/employees?${new URLSearchParams({ search: term, pageSize: '8', status: 'CURRENT' }).toString()}`,
      ),
    enabled: open && term.length > 0,
  });
  const options = (results.data?.items ?? []).filter((e) => e.id !== exclude);

  if (value) {
    return (
      <div className="flex min-h-10 items-center justify-between gap-2 rounded-md border border-border bg-card px-3 py-1.5">
        <span id={id}>{value.name}</span>
        <button
          type="button"
          className="text-[13px] font-medium text-primary hover:underline"
          onClick={() => onChange(null)}
        >
          Change<span className="sr-only"> {value.name}</span>
        </button>
      </div>
    );
  }
  return (
    <div className="relative">
      <Input
        id={id}
        role="combobox"
        aria-expanded={open && options.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        placeholder="Type a name or employee number"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
        }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && term && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-md border border-border bg-card py-1 shadow-lg"
        >
          {results.isPending ? (
            <li className="px-3 py-2 text-[13px] text-muted-foreground">Searching…</li>
          ) : options.length === 0 ? (
            <li className="px-3 py-2 text-[13px] text-muted-foreground">Nobody matches</li>
          ) : (
            options.map((e) => (
              <li key={e.id} role="option" aria-selected={false}>
                <button
                  type="button"
                  className={cn('flex w-full flex-col items-start px-3 py-2 text-left hover:bg-muted')}
                  onMouseDown={(ev) => ev.preventDefault()}
                  onClick={() => {
                    onChange({ id: e.id, name: e.name });
                    setText('');
                    setOpen(false);
                  }}
                >
                  <span className="font-medium">{e.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {e.employeeCode}
                    {e.designation ? ` · ${e.designation.name}` : ''}
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
