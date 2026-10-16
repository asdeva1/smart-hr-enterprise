'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import { EmptyState, Loading, PageHeader } from '@/components/ui/page-header';
import { errorMessage } from '@/lib/admin';
import { useOrgChart, type OrgChartNode } from '@/lib/employees';
import { initials } from '@/lib/utils';

/**
 * Who reports to whom, as an expandable tree. People whose manager you can't see (or who have none) start
 * a tree of their own.
 */
export function OrgChart() {
  const chart = useOrgChart();
  const [filter, setFilter] = useState('');
  const { roots, children } = useMemo(() => {
    const nodes = chart.data ?? [];
    const ids = new Set(nodes.map((n) => n.id));
    const kids = new Map<string, OrgChartNode[]>();
    const top: OrgChartNode[] = [];
    for (const n of nodes) {
      if (n.managerId && ids.has(n.managerId)) kids.set(n.managerId, [...(kids.get(n.managerId) ?? []), n]);
      else top.push(n);
    }
    return { roots: top, children: kids };
  }, [chart.data]);
  const term = filter.trim().toLowerCase();
  const matches = (n: OrgChartNode): boolean =>
    !term ||
    n.name.toLowerCase().includes(term) ||
    n.employeeCode.toLowerCase().includes(term) ||
    (children.get(n.id) ?? []).some(matches);

  return (
    <>
      <nav aria-label="Breadcrumb" className="text-[13px]">
        <Link href="/employees" className="text-primary hover:underline">
          Employees
        </Link>{' '}
        <span className="text-muted-foreground">/ Organisation chart</span>
      </nav>
      <PageHeader
        title="Organisation chart"
        description="Who reports to whom, among the people you can see."
      />
      <label className="flex max-w-md flex-col gap-1.5">
        <span className="text-[13px] font-medium">Find someone</span>
        <Input
          type="search"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Name or employee number"
        />
      </label>
      {chart.isPending ? (
        <Loading />
      ) : chart.isError ? (
        <Alert tone="error">{errorMessage(chart.error)}</Alert>
      ) : roots.length === 0 ? (
        <EmptyState title="No employees yet" />
      ) : (
        <ul role="tree" aria-label="Organisation chart" className="flex flex-col gap-1">
          {roots.filter(matches).map((n) => (
            <Branch key={n.id} node={n} childrenOf={children} matches={matches} open={!!term} />
          ))}
        </ul>
      )}
    </>
  );
}

function Branch({
  node,
  childrenOf,
  matches,
  open,
  depth = 0,
}: {
  node: OrgChartNode;
  childrenOf: Map<string, OrgChartNode[]>;
  matches: (n: OrgChartNode) => boolean;
  open: boolean;
  depth?: number;
}) {
  const kids = (childrenOf.get(node.id) ?? []).filter(matches);
  const [expanded, setExpanded] = useState(depth < 1);
  const showKids = open || expanded;
  return (
    <li
      role="treeitem"
      aria-expanded={kids.length ? showKids : undefined}
      id={node.id}
      className="flex flex-col gap-1"
    >
      <div className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2">
        {kids.length > 0 ? (
          <button
            type="button"
            onClick={() => setExpanded((x) => !x)}
            className="grid size-6 place-items-center rounded text-muted-foreground hover:bg-muted"
            aria-label={`${showKids ? 'Collapse' : 'Expand'} ${node.name}'s team`}
          >
            {showKids ? '−' : '+'}
          </button>
        ) : (
          <span className="size-6" aria-hidden="true" />
        )}
        <span
          aria-hidden="true"
          className="grid size-8 place-items-center rounded-full bg-primary-soft text-xs font-semibold text-primary"
        >
          {initials(node.name)}
        </span>
        <span className="flex min-w-0 flex-col">
          <Link href={`/employees/${node.id}`} className="font-medium hover:text-primary hover:underline">
            {node.name}
          </Link>
          <span className="truncate text-xs text-muted-foreground">
            {[node.designation, node.department].filter(Boolean).join(' · ') || node.employeeCode}
          </span>
        </span>
        {kids.length > 0 && (
          <span className="ml-auto text-xs whitespace-nowrap text-muted-foreground">
            {kids.length} {kids.length === 1 ? 'report' : 'reports'}
          </span>
        )}
      </div>
      {kids.length > 0 && showKids && (
        <ul role="group" className="ml-6 flex flex-col gap-1 border-l border-border pl-4">
          {kids.map((k) => (
            <Branch
              key={k.id}
              node={k}
              childrenOf={childrenOf}
              matches={matches}
              open={open}
              depth={depth + 1}
            />
          ))}
        </ul>
      )}
    </li>
  );
}
