export type SearchKind = 'person' | 'project' | 'ops_item' | 'asset' | 'inventory_item';

export interface SearchHit {
  kind: SearchKind;
  id: string;
  title: string;
  subtitle: string;
  href: string;
}

export const KIND_LABEL: Record<SearchKind, string> = {
  person: 'People',
  project: 'Projects',
  ops_item: 'Work items',
  asset: 'Assets',
  inventory_item: 'Stock items',
};

export const searchKeys = { find: (q: string) => ['search', q] as const };

/** Groups hits in a fixed order, keeping each group's own order. */
export function groupHits(hits: SearchHit[]): { kind: SearchKind; label: string; hits: SearchHit[] }[] {
  return (Object.keys(KIND_LABEL) as SearchKind[])
    .map((kind) => ({ kind, label: KIND_LABEL[kind], hits: hits.filter((h) => h.kind === kind) }))
    .filter((g) => g.hits.length > 0);
}
