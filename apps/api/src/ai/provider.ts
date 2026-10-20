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
