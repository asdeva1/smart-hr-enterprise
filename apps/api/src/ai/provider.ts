import { createHash, createHmac } from 'node:crypto';
import { AppError } from '@smart-hr/shared';

export type AiBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string };

export interface AiMessage {
  role: 'user' | 'assistant';
  content: string | AiBlock[];
}

export interface AiToolSpec {
  name: string;
  description: string;
  input_schema: { type: 'object'; properties: Record<string, unknown>; required?: string[] };
}

export interface AiRequest {
  model: string;
  system: string;
  messages: AiMessage[];
  tools?: AiToolSpec[];
  maxTokens: number;
}

export interface AiResponse {
  content: AiBlock[];
  stopReason: string | null;
  usage: { input: number; output: number };
}

/** The one thing the rest of the API knows about a model provider, so providers can be swapped. */
export interface AiProvider {
  readonly name: string;
  complete(request: AiRequest): Promise<AiResponse>;
}

interface AnthropicResponse {
  content?: AiBlock[];
  stop_reason?: string | null;
  usage?: { input_tokens?: number; output_tokens?: number };
}

/** Anthropic's Messages API over plain HTTPS. The key stays on the server and never appears in an error. */
export class AnthropicProvider implements AiProvider {
  readonly name = 'anthropic';

  constructor(
    private readonly apiKey: string,
    private readonly baseUrl: string,
    private readonly timeoutMs = 60_000,
  ) {}

  async complete(request: AiRequest): Promise<AiResponse> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl.replace(/\/$/, '')}/v1/messages`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: request.model,
          max_tokens: request.maxTokens,
          system: request.system,
          messages: request.messages,
          ...(request.tools?.length ? { tools: request.tools } : {}),
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      throw new AppError('AI_UNAVAILABLE', 'The AI service didn’t answer. Try again in a moment.', 502);
    }
    if (!res.ok) {
      throw new AppError(
        'AI_UNAVAILABLE',
        res.status === 429
          ? 'The AI service is busy. Try again in a moment.'
          : 'The AI service couldn’t complete that request.',
        502,
      );
    }
    const body = (await res.json()) as AnthropicResponse;
    return {
      content: body.content ?? [],
      stopReason: body.stop_reason ?? null,
      usage: { input: body.usage?.input_tokens ?? 0, output: body.usage?.output_tokens ?? 0 },
    };
  }
}

export interface BedrockAuth {
  /** A Bedrock API key, sent as a bearer token. */
  bearerToken?: string | undefined;
  /** IAM keys, used to sign each request (SigV4). A session token is needed for role credentials. */
  accessKeyId?: string | undefined;
  secretAccessKey?: string | undefined;
  sessionToken?: string | undefined;
}

const sha256 = (data: string) => createHash('sha256').update(data).digest('hex');
const hmac = (key: string | Buffer, data: string) => createHmac('sha256', key).update(data).digest();

/** SigV4 headers for one POST to Bedrock. Exported so the signing can be tested against known values. */
export function signBedrockRequest(input: {
  url: URL;
  body: string;
  region: string;
  auth: BedrockAuth;
  now?: Date;
}): Record<string, string> {
  const { url, body, region, auth } = input;
  const iso = (input.now ?? new Date()).toISOString().replace(/[:-]|\.\d{3}/g, '');
  const day = iso.slice(0, 8);
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    host: url.host,
    'x-amz-date': iso,
    ...(auth.sessionToken ? { 'x-amz-security-token': auth.sessionToken } : {}),
  };
  const names = Object.keys(headers).sort();
  const canonicalHeaders = names.map((n) => `${n}:${headers[n]!.trim()}\n`).join('');
  const signedHeaders = names.join(';');
  // Each path segment is encoded twice for every service except S3.
  const canonicalPath = url.pathname
    .split('/')
    .map((seg) =>
      encodeURIComponent(seg).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`),
    )
    .join('/');
  const canonical = ['POST', canonicalPath, '', canonicalHeaders, signedHeaders, sha256(body)].join('\n');
  const scope = `${day}/${region}/bedrock/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', iso, scope, sha256(canonical)].join('\n');
  const key = hmac(
    hmac(hmac(hmac(`AWS4${auth.secretAccessKey ?? ''}`, day), region), 'bedrock'),
    'aws4_request',
  );
  const signature = createHmac('sha256', key).update(toSign).digest('hex');
  const { host: _host, ...send } = headers;
  return {
    ...send,
    authorization: `AWS4-HMAC-SHA256 Credential=${auth.accessKeyId ?? ''}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}

/**
 * Claude on Amazon Bedrock, so usage lands on the organisation's AWS invoice. The model is part of the URL, and
 * credentials never appear in an error.
 */
export class BedrockProvider implements AiProvider {
  readonly name = 'bedrock';

  constructor(
    private readonly auth: BedrockAuth,
    private readonly region: string,
    private readonly baseUrl?: string,
    private readonly timeoutMs = 60_000,
  ) {}

  async complete(request: AiRequest): Promise<AiResponse> {
    const base = (this.baseUrl ?? `https://bedrock-runtime.${this.region}.amazonaws.com`).replace(/\/$/, '');
    const url = new URL(`${base}/model/${encodeURIComponent(request.model)}/invoke`);
    const body = JSON.stringify({
      anthropic_version: 'bedrock-2023-05-31',
      max_tokens: request.maxTokens,
      system: request.system,
      messages: request.messages,
      ...(request.tools?.length ? { tools: request.tools } : {}),
    });
    const headers = this.auth.bearerToken
      ? { 'content-type': 'application/json', authorization: `Bearer ${this.auth.bearerToken}` }
      : signBedrockRequest({ url, body, region: this.region, auth: this.auth });
    let res: Response;
    try {
      res = await fetch(url, { method: 'POST', headers, body, signal: AbortSignal.timeout(this.timeoutMs) });
    } catch {
      throw new AppError('AI_UNAVAILABLE', 'The AI service didn’t answer. Try again in a moment.', 502);
    }
    if (!res.ok) {
      throw new AppError(
        'AI_UNAVAILABLE',
        res.status === 429 || res.status === 503
          ? 'The AI service is busy. Try again in a moment.'
          : 'The AI service couldn’t complete that request.',
        502,
      );
    }
    const parsed = (await res.json()) as AnthropicResponse;
    return {
      content: parsed.content ?? [],
      stopReason: parsed.stop_reason ?? null,
      usage: { input: parsed.usage?.input_tokens ?? 0, output: parsed.usage?.output_tokens ?? 0 },
    };
  }
}
