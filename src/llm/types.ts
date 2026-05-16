export type ChatRole = "system" | "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface GenerateOptions {
  responseFormat?: "json";
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
}

export interface LlmProvider {
  generate(messages: ChatMessage[], options?: GenerateOptions): Promise<string>;
}
