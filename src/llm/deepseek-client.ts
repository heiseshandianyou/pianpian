import { loadLocalEnv } from "../config/load-env.js";
import type { ChatMessage, GenerateOptions, LlmProvider } from "./types.js";

interface DeepSeekClientOptions {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  reasoningEffort?: "low" | "medium" | "high" | "max";
  thinking?: boolean;
  timeoutMs?: number;
}

interface DeepSeekChatResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
  error?: {
    message?: string;
  };
}

export class DeepSeekClient implements LlmProvider {
  private readonly apiKey?: string;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly reasoningEffort: "low" | "medium" | "high" | "max";
  private readonly thinking: boolean;
  private readonly timeoutMs: number;

  constructor(options: DeepSeekClientOptions = {}) {
    loadLocalEnv();
    this.apiKey = options.apiKey ?? process.env.DEEPSEEK_API_KEY;
    this.baseUrl = trimTrailingSlash(options.baseUrl ?? process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com");
    this.model = options.model ?? process.env.DEEPSEEK_MODEL ?? "deepseek-v4-pro";
    this.reasoningEffort =
      options.reasoningEffort ?? parseReasoningEffort(process.env.DEEPSEEK_REASONING_EFFORT) ?? "medium";
    this.thinking = options.thinking ?? parseBoolean(process.env.DEEPSEEK_THINKING) ?? true;
    this.timeoutMs = options.timeoutMs ?? parsePositiveInt(process.env.DEEPSEEK_TIMEOUT_MS) ?? 18_000;
  }

  isConfigured(): boolean {
    return Boolean(this.apiKey);
  }

  async generate(messages: ChatMessage[], options: GenerateOptions = {}): Promise<string> {
    if (!this.apiKey) {
      throw new Error("DEEPSEEK_API_KEY is not configured.");
    }

    const controller = new AbortController();
    const timeoutMs = options.timeoutMs ?? this.timeoutMs;
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const body: Record<string, unknown> = {
      model: this.model,
      messages,
      stream: false,
      max_tokens: options.maxTokens,
      temperature: options.temperature,
      response_format: options.responseFormat === "json" ? { type: "json_object" } : undefined,
    };
    if (this.thinking) {
      body.thinking = { type: "enabled" };
      body.reasoning_effort = this.reasoningEffort;
    } else {
      body.thinking = { type: "disabled" };
    }

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(`DeepSeek API request timed out after ${timeoutMs}ms.`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }

    const payload = (await response.json()) as DeepSeekChatResponse;
    if (!response.ok) {
      throw new Error(payload.error?.message ?? `DeepSeek API request failed with ${response.status}.`);
    }

    const content = payload.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error("DeepSeek API returned an empty message.");
    }

    return content;
  }
}

export function createDefaultDeepSeekClient(): DeepSeekClient {
  return new DeepSeekClient();
}

function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function parseReasoningEffort(value: string | undefined): "low" | "medium" | "high" | "max" | undefined {
  if (value === "low" || value === "medium" || value === "high") {
    return value;
  }
  if (value === "max" || value === "xhigh") {
    return "max";
  }
  return undefined;
}

function parseBoolean(value: string | undefined): boolean | undefined {
  if (!value) {
    return undefined;
  }

  if (["1", "true", "yes", "on", "enabled"].includes(value.toLowerCase())) {
    return true;
  }
  if (["0", "false", "no", "off", "disabled"].includes(value.toLowerCase())) {
    return false;
  }
  return undefined;
}

function parsePositiveInt(value: string | undefined): number | undefined {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return undefined;
  }
  return parsed;
}
