'use client';

import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { groupHits, searchKeys, type SearchHit } from '@/lib/search';

/** Header search box: people, projects, work items, assets and stock the signed-in person can already open. */
export function GlobalSearch() {
  const [text, setText] = useState('');
  const [term, setTerm] = useState('');
  const [open, setOpen] = useState(false);
  const listId = useId();
  const root = useRef<HTMLDivElement>(null);
  const router = useRouter();

  // Wait for a pause in typing so each keystroke isn't a request.
  useEffect(() => {
    const t = setTimeout(() => setTerm(text.trim()), 250);
    return () => clearTimeout(t);
  }, [text]);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const enabled = term.length >= 2;
  const results = useQuery({
    queryKey: searchKeys.find(term),
    queryFn: () => apiFetch<SearchHit[]>(`/v1/search?q=${encodeURIComponent(term)}`),
    enabled,
    staleTime: 15_000,
  });
  const groups = groupHits(results.data ?? []);

  function go(hit: SearchHit) {
    setOpen(false);
    setText('');
    router.push(hit.href);
  }

  return (
    <div ref={root} className="relative w-64 max-w-full">
      <label className="relative block">
        <span className="sr-only">Search</span>
        <Search aria-hidden="true" className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
        <input
          type="search"
          value={text}
          placeholder="Search people, projects, assets…"
          autoComplete="off"
          aria-controls={listId}
          aria-expanded={open && enabled}
          className="h-9 w-full rounded-md border border-border bg-card pl-8 pr-2 text-sm"
          onChange={(e) => {
            setText(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setOpen(false);
            if (e.key === 'Enter' && groups[0]) go(groups[0].hits[0]!);
          }}
        />
      </label>
      {open && enabled && (
        <div
          id={listId}
          className="absolute right-0 z-30 mt-1 max-h-96 w-96 max-w-[90vw] overflow-auto rounded-md border border-border bg-card p-1 shadow-lg"
        >
          {results.isPending && <p className="p-3 text-sm text-muted-foreground">Searching…</p>}
          {results.isError && (
            <p role="alert" className="p-3 text-sm text-danger">
              Search isn’t available right now.
            </p>
          )}
          {results.data && groups.length === 0 && (
            <p className="p-3 text-sm text-muted-foreground">Nothing found for “{term}”.</p>
          )}
          {groups.map((g) => (
            <section key={g.kind} aria-label={g.label}>
              <h3 className="px-2 pb-1 pt-2 text-xs font-semibold uppercase text-muted-foreground">
                {g.label}
              </h3>
              {g.hits.map((h) => (
                <button
                  key={`${h.kind}-${h.id}`}
                  type="button"
                  className="flex w-full flex-col rounded px-2 py-1.5 text-left hover:bg-muted"
                  onClick={() => go(h)}
                >
                  <span className="text-sm font-medium">{h.title}</span>
                  <span className="text-xs text-muted-foreground">{h.subtitle}</span>
                </button>
              ))}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
