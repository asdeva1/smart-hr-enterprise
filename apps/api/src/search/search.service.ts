import { Injectable } from '@nestjs/common';
import { hasFeature, type Feature } from '@smart-hr/entitlements';
import type { Permission } from '@smart-hr/shared';
import type { AuthContext, TenantContext } from '../auth/auth.types.js';
import { AssetsService } from '../assets/assets.service.js';
import { EmployeesService } from '../employees/employees.service.js';
import { EntitlementsService } from '../entitlements/entitlements.service.js';
import { InventoryService } from '../inventory/inventory.service.js';
import { OperationsService } from '../operations/operations.service.js';
import { ProjectsService } from '../projects/projects.service.js';

export type SearchKind = 'person' | 'project' | 'ops_item' | 'asset' | 'inventory_item';

export interface SearchHit {
  kind: SearchKind;
  id: string;
  title: string;
  subtitle: string;
  /** Page in the web app that opens it. */
  href: string;
}

const PER_KIND = 5;
const MAX_WORKSPACES = 20;

const has = (text: string, term: string) => text.toLowerCase().includes(term);

/** A group that can't be searched, because of the plan or the person's role, is left out, never an error. */
async function group<T>(build: () => Promise<T[]>): Promise<T[]> {
  try {
    return await build();
  } catch {
    return [];
  }
}

/**
 * One search box across the organisation. Each group is read through the same service, permission check and
 * visibility scope as that module's own page, so a result is always something the person could already open.
 */
@Injectable()
export class SearchService {
  constructor(
    private readonly employees: EmployeesService,
    private readonly projects: ProjectsService,
    private readonly operations: OperationsService,
    private readonly assets: AssetsService,
    private readonly inventory: InventoryService,
    private readonly entitlements: EntitlementsService,
  ) {}

  async search(tenant: TenantContext, auth: AuthContext, rawQuery: string): Promise<SearchHit[]> {
    const q = rawQuery.trim().toLowerCase();
    if (q.length < 2) return [];
    const features = await this.employees.run(tenant, auth, (tx) => this.entitlements.forTenant(tx));
    const can = (code: Permission, feature?: Feature) =>
      tenant.permissions.hasAnywhere(code) && (!feature || hasFeature(features, feature));

    const [people, projects, items, assets, stock] = await Promise.all([
      can('employees.view')
        ? group<SearchHit>(async () => {
            const page = await this.employees.list(tenant, auth, {
              search: rawQuery.trim(),
              status: 'CURRENT',
              sort: 'name',
              page: 1,
              pageSize: PER_KIND,
            });
            return page.items.map((e) => ({
              kind: 'person' as const,
              id: e.id,
              title: e.name,
              subtitle: e.employeeCode,
              href: `/employees/${e.id}`,
            }));
          })
        : [],
      can('projects.view', 'projects')
        ? group<SearchHit>(async () =>
            (await this.projects.list(tenant, auth, {}))
              .filter((p) => has(p.name, q) || has(p.code, q) || has(p.clientName ?? '', q))
              .slice(0, PER_KIND)
              .map((p) => ({
                kind: 'project' as const,
                id: p.id,
                title: p.name,
                subtitle: p.code,
                href: `/projects/${p.id}`,
              })),
          )
        : [],
      can('operations.view', 'operations.templates') || can('operations.contribute', 'operations.templates')
        ? group<SearchHit>(async () => {
            const spaces = (await this.operations.list(tenant, auth)).slice(0, MAX_WORKSPACES);
            const found = await Promise.all(
              spaces.map((w) =>
                group(() =>
                  this.operations.items(tenant, auth, w.id, { q: rawQuery.trim(), limit: PER_KIND }),
                ),
              ),
            );
            return found
              .flat()
              .slice(0, PER_KIND)
              .map((i) => ({
                kind: 'ops_item' as const,
                id: i.id,
                title: i.title,
                subtitle: `${i.ref} · ${i.workspace.name}`,
                href: `/operations/items/${i.id}`,
              }));
          })
        : [],
      can('assets.view', 'assets')
        ? group<SearchHit>(async () =>
            (await this.assets.list(tenant, auth, { q: rawQuery.trim() })).slice(0, PER_KIND).map((a) => ({
              kind: 'asset' as const,
              id: a.id,
              title: a.name,
              subtitle: a.tag,
              href: '/assets',
            })),
          )
        : [],
      can('inventory.view', 'inventory')
        ? group<SearchHit>(async () =>
            (await this.inventory.items(tenant, auth))
              .filter((i) => has(i.name, q) || has(i.sku, q))
              .slice(0, PER_KIND)
              .map((i) => ({
                kind: 'inventory_item' as const,
                id: i.id,
                title: i.name,
                subtitle: i.sku,
                href: '/inventory',
              })),
          )
        : [],
    ]);
    return [...people, ...projects, ...items, ...assets, ...stock];
  }
}
