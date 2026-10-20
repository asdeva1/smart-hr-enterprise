import pg from 'pg';

export class UnsafeDatabaseRoleError extends Error {
  constructor(role: string, reasons: string[]) {
    super(
      `Refusing to start: the database role "${role}" ${reasons.join(' and ')}, so row-level security would ` +
        'not isolate tenants. Point DATABASE_URL at the restricted runtime role (app_rw) and keep the ' +
        'owner role for DATABASE_MIGRATOR_URL only. See docs/deployment/KUBERNS.md.',
    );
    this.name = 'UnsafeDatabaseRoleError';
  }
}

/**
 * Fails closed when the runtime connection could bypass row-level security: a superuser, a role with
 * BYPASSRLS, or the owner of the tables (owners are exempt from their tables' policies).
 */
export async function assertRestrictedRuntimeRole(connectionString: string): Promise<void> {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    const { rows } = await client.query<{ role: string; super: boolean; bypass: boolean; owned: number }>(
      `SELECT current_user AS role, r.rolsuper AS super, r.rolbypassrls AS bypass,
              (SELECT count(*)::int FROM pg_tables t WHERE t.schemaname = 'public' AND t.tableowner = current_user) AS owned
         FROM pg_roles r WHERE r.rolname = current_user`,
    );
    const r = rows[0]!;
    const reasons: string[] = [];
    if (r.super) reasons.push('is a superuser');
    if (r.bypass) reasons.push('has BYPASSRLS');
    if (r.owned > 0) reasons.push(`owns ${r.owned} application tables`);
    if (reasons.length) throw new UnsafeDatabaseRoleError(r.role, reasons);
  } finally {
    await client.end();
  }
}

const RUNTIME_ROLE = 'app_rw';

/**
 * Ensures the restricted runtime role exists, connected as the schema owner (the migrator). Without a
 * password it is created NOLOGIN, which is enough for migrations to grant to it; with one it is made a
 * LOGIN role with that password. Always NOSUPERUSER NOBYPASSRLS. Idempotent; never logs the password.
 */
export async function ensureRuntimeRole(ownerConnectionString: string, password?: string) {
  const client = new pg.Client({ connectionString: ownerConnectionString });
  await client.connect();
  try {
    const existing = (
      await client.query<{ super: boolean; bypass: boolean }>(
        'SELECT rolsuper AS super, rolbypassrls AS bypass FROM pg_roles WHERE rolname = $1',
        [RUNTIME_ROLE],
      )
    ).rows[0];
    const exists = !!existing;
    // Nothing to change: an existing restricted role and no new password.
    if (existing && !password && !existing.super && !existing.bypass) return { created: false, login: false };
    const login = password ? `LOGIN PASSWORD ${client.escapeLiteral(password)}` : exists ? '' : 'NOLOGIN';
    await client.query(
      `${exists ? 'ALTER' : 'CREATE'} ROLE ${RUNTIME_ROLE} NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE ${login}`,
    );
    const db = (await client.query<{ db: string }>('SELECT current_database() AS db')).rows[0]!.db;
    await client.query(`GRANT CONNECT ON DATABASE ${client.escapeIdentifier(db)} TO ${RUNTIME_ROLE}`);
    await client.query(`GRANT USAGE ON SCHEMA public TO ${RUNTIME_ROLE}`);
    return { created: !exists, login: !!password };
  } finally {
    await client.end();
  }
}
