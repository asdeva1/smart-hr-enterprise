import { Inject, Injectable } from '@nestjs/common';
import { limitOf } from '@smart-hr/entitlements';
import { createHash } from 'node:crypto';
import type { DatabaseClient, TenantTransaction } from '@smart-hr/database';
import { withContext } from '@smart-hr/database';
import { AppError } from '@smart-hr/shared';
import { AuditService } from '../audit/audit.service.js';
import type { AuthContext, TenantContext } from '../auth/auth.types.js';
import type { ApiEnv } from '../config/env.js';
import type { RequestMeta } from '../common/request-context.js';
import { EntitlementsService } from '../entitlements/entitlements.service.js';
import { API_ENV, DATABASE } from '../infra/tokens.js';
import {
  AnthropicProvider,
  BedrockProvider,
  type AiBlock,
  type AiMessage,
  type AiProvider,
} from './provider.js';
import type { AiTool } from './tools.js';

const MAX_TOOL_ROUNDS = 4;
const POLICY_KEY = 'ai.policy';

/** Hashed so the audit trail can show something was asked without keeping what was asked. */
const fingerprint = (text: string) => createHash('sha256').update(text).digest('hex').slice(0, 12);

function monthStart(now: Date) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/**
 * The AI layer. Every call is checked against the organisation's own switch and its monthly token budget,
 * answers only from what the signed-in person is allowed to see (tools run as them), and leaves a usage
 * record with token counts, never the question or the answer.
 */
@Injectable()
export class AiService {
  private readonly provider: AiProvider | null;
  private readonly tools = new Map<string, AiTool>();

  constructor(
    @Inject(DATABASE) private readonly db: DatabaseClient,
    @Inject(API_ENV) private readonly env: ApiEnv,
    private readonly entitlements: EntitlementsService,
    private readonly audit: AuditService,
  ) {
    this.provider = this.buildProvider(env);
  }

  private buildProvider(env: ApiEnv): AiProvider | null {
    if (env.AI_PROVIDER === 'bedrock') {
      return new BedrockProvider(
        {
          bearerToken: env.AWS_BEARER_TOKEN_BEDROCK,
          accessKeyId: env.AWS_ACCESS_KEY_ID,
          secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
          sessionToken: env.AWS_SESSION_TOKEN,
        },
        env.AWS_REGION ?? 'us-east-1',
        env.BEDROCK_BASE_URL,
      );
    }
    return env.ANTHROPIC_API_KEY
      ? new AnthropicProvider(env.ANTHROPIC_API_KEY, env.ANTHROPIC_BASE_URL)
      : null;
  }

  private get model(): string {
    return this.env.AI_MODEL ?? 'claude-sonnet-5-5';
  }

  registerTool(tool: AiTool): void {
    this.tools.set(tool.name, tool);
  }

  private run<T>(tenant: TenantContext, auth: AuthContext, work: (tx: TenantTransaction) => Promise<T>) {
    return withContext(this.db, { tenantId: tenant.id, userId: auth.user.id }, work);
  }

  private async enabled(tx: TenantTransaction): Promise<boolean> {
    const row = await tx.tenantSetting.findUnique({
      where: { tenantId_key: { tenantId: await this.tenantId(tx), key: POLICY_KEY } },
    });
    return (row?.value as { enabled?: boolean } | null)?.enabled === true;
  }

  private async tenantId(tx: TenantTransaction): Promise<string> {
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT current_setting('app.tenant_id') AS id`;
    return rows[0]!.id;
  }

  private async usedThisMonth(tx: TenantTransaction, now: Date): Promise<number> {
    const sum = await tx.aiUsageEvent.aggregate({
      where: { createdAt: { gte: monthStart(now) } },
      _sum: { inputTokens: true, outputTokens: true },
    });
    return (sum._sum.inputTokens ?? 0) + (sum._sum.outputTokens ?? 0);
  }

  status(tenant: TenantContext, auth: AuthContext, now = new Date()) {
    return this.run(tenant, auth, async (tx) => {
      const e = await this.entitlements.forTenant(tx);
      return {
        available: this.provider !== null,
        enabled: await this.enabled(tx),
        model: this.model,
        tokensUsed: await this.usedThisMonth(tx, now),
        tokenLimit: limitOf(e, 'ai.tokens.monthly'),
      };
    });
  }

  setPolicy(tenant: TenantContext, auth: AuthContext, input: { enabled: boolean }, meta: RequestMeta) {
    return this.run(tenant, auth, async (tx) => {
      await tx.tenantSetting.upsert({
        where: { tenantId_key: { tenantId: tenant.id, key: POLICY_KEY } },
        create: { tenantId: tenant.id, key: POLICY_KEY, value: { enabled: input.enabled } },
        update: { value: { enabled: input.enabled } },
      });
      await this.audit.recordInTransaction(
        tx,
        {
          action: 'ai.policy.set',
          outcome: 'SUCCESS',
          tenantId: tenant.id,
          actorUserId: auth.user.id,
          targetType: 'tenant',
          targetId: tenant.id,
          metadata: { enabled: input.enabled ? 1 : 0 },
        },
        meta,
      );
      return { enabled: input.enabled };
    });
  }

  /** Token use this month by feature and by person, for the organisation's administrators. */
  usage(tenant: TenantContext, auth: AuthContext, now = new Date()) {
    return this.run(tenant, auth, async (tx) => {
      const rows = await tx.aiUsageEvent.groupBy({
        by: ['feature', 'userId'],
        where: { createdAt: { gte: monthStart(now) } },
        _sum: { inputTokens: true, outputTokens: true },
        _count: { _all: true },
      });
      return rows.map((r) => ({
        feature: r.feature,
        userId: r.userId,
        calls: r._count._all,
        tokens: (r._sum.inputTokens ?? 0) + (r._sum.outputTokens ?? 0),
      }));
    });
  }

  /**
   * Runs a conversation with the model, letting it call the registered read-only tools (as the signed-in
   * person) for up to a few rounds. Returns the final text and which tools were used.
   */
  async ask(
    tenant: TenantContext,
    auth: AuthContext,
    meta: RequestMeta,
    options: {
      feature: string;
      system: string;
      messages: AiMessage[];
      toolNames?: string[];
      now?: Date;
    },
  ): Promise<{ reply: string; toolsUsed: string[]; tokens: number }> {
    const provider = this.provider;
    if (!provider) {
      throw new AppError('AI_NOT_CONFIGURED', 'AI isn’t set up on this server yet.', 503);
    }
    const now = options.now ?? new Date();
    const limit = await this.run(tenant, auth, async (tx) => {
      if (!(await this.enabled(tx))) {
        throw new AppError(
          'AI_DISABLED',
          'AI is switched off for your organisation. An administrator can turn it on in settings.',
          403,
        );
      }
      const e = await this.entitlements.forTenant(tx);
      const cap = limitOf(e, 'ai.tokens.monthly');
      if (cap !== null && (await this.usedThisMonth(tx, now)) >= cap) {
        throw new AppError(
          'AI_BUDGET_REACHED',
          'Your organisation has used its AI allowance for this month.',
          429,
        );
      }
      return cap;
    });

    const tools = (options.toolNames ?? []).flatMap((n) => {
      const t = this.tools.get(n);
      return t ? [t] : [];
    });
    const messages: AiMessage[] = [...options.messages];
    const toolsUsed: string[] = [];
    let input = 0;
    let output = 0;
    let reply = '';
    try {
      for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
        const res = await provider.complete({
          model: this.model,
          system: options.system,
          messages,
          ...(tools.length
            ? {
                tools: tools.map((t) => ({
                  name: t.name,
                  description: t.description,
                  input_schema: t.inputSchema,
                })),
              }
            : {}),
          maxTokens: this.env.AI_MAX_OUTPUT_TOKENS,
        });
        input += res.usage.input;
        output += res.usage.output;
        const calls = res.content.filter(
          (b): b is Extract<AiBlock, { type: 'tool_use' }> => b.type === 'tool_use',
        );
        reply = res.content
          .filter((b): b is Extract<AiBlock, { type: 'text' }> => b.type === 'text')
          .map((b) => b.text)
          .join('')
          .trim();
        if (calls.length === 0 || round === MAX_TOOL_ROUNDS) break;
        if (limit !== null && input + output >= limit) break;
        messages.push({ role: 'assistant', content: res.content });
        const results: AiBlock[] = [];
        for (const call of calls) {
          const tool = tools.find((t) => t.name === call.name);
          let content: string;
          if (!tool) {
            content = JSON.stringify({ error: 'unknown tool' });
          } else {
            toolsUsed.push(tool.name);
            try {
              content = JSON.stringify(await tool.run(tenant, auth, call.input));
            } catch {
              content = JSON.stringify({ error: 'That information isn’t available to you.' });
            }
          }
          results.push({ type: 'tool_result', tool_use_id: call.id, content });
        }
        messages.push({ role: 'user', content: results });
      }
    } finally {
      if (input + output > 0) {
        await this.run(tenant, auth, async (tx) => {
          await tx.aiUsageEvent.create({
            data: {
              tenantId: tenant.id,
              userId: auth.user.id,
              feature: options.feature,
              model: this.model,
              inputTokens: input,
              outputTokens: output,
            },
          });
          await this.audit.recordInTransaction(
            tx,
            {
              action: 'ai.request',
              outcome: 'SUCCESS',
              tenantId: tenant.id,
              actorUserId: auth.user.id,
              targetType: 'ai',
              targetId: tenant.id,
              metadata: {
                feature: options.feature,
                tokens: input + output,
                tools: toolsUsed.length,
                question: fingerprint(JSON.stringify(options.messages.at(-1)?.content ?? '')),
              },
            },
            meta,
          );
        });
      }
    }
    return {
      reply: reply || 'I couldn’t put an answer together. Try rephrasing the question.',
      toolsUsed,
      tokens: input + output,
    };
  }
}
