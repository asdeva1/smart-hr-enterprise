import { describe, expect, it } from 'vitest';
import { groupHits, type SearchHit } from './search';

const hit = (kind: SearchHit['kind'], title: string): SearchHit => ({
  kind,
  id: title,
  title,
  subtitle: '',
  href: '/',
});

describe('groupHits', () => {
  it('orders groups the same way every time and drops empty ones', () => {
    const groups = groupHits([hit('asset', 'a1'), hit('person', 'p1'), hit('person', 'p2')]);
    expect(groups.map((g) => g.label)).toEqual(['People', 'Assets']);
    expect(groups[0]!.hits.map((h) => h.title)).toEqual(['p1', 'p2']);
  });

  it('returns nothing for no hits', () => {
    expect(groupHits([])).toEqual([]);
  });
});
