import type { AuthContext, TenantContext } from '../auth/auth.types.js';

/** A read-only lookup the assistant may use. It runs as the signed-in person, so their access rules apply. */
export interface AiTool {
  name: string;
  description: string;
  inputSchema: { type: 'object'; properties: Record<string, unknown>; required?: string[] };
  run(tenant: TenantContext, auth: AuthContext, input: Record<string, unknown>): Promise<unknown>;
}
