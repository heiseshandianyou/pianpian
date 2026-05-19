# DeepSeek Integration

Pianpian uses DeepSeek through an OpenAI-compatible chat completions endpoint.

## Environment

Create a local `.env` or set environment variables in your shell. Do not commit real keys. The runtime loads `.env` automatically when it exists.

```bash
DEEPSEEK_API_KEY=your_key_here
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-v4-pro
DEEPSEEK_THINKING=true
DEEPSEEK_REASONING_EFFORT=medium
```

PowerShell example:

```powershell
$env:DEEPSEEK_API_KEY="your_key_here"
$env:DEEPSEEK_MODEL="deepseek-v4-pro"
$env:DEEPSEEK_THINKING="true"
$env:DEEPSEEK_REASONING_EFFORT="medium"
npm run demo
```

## Current Usage

The main LLM-backed components are `MemoryFormationAgent` and `CompanionAgent`.

When configured, `MemoryFormationAgent` asks DeepSeek to produce a structured `MemoryFormationPlan`:

```text
perception + retrieved memories
  -> DeepSeek
  -> memory nodes + memory edges + rationale
  -> schema normalization
  -> Markdown-backed MemoryStore.applyFormation()
```

If DeepSeek is not configured or the call fails, the agent falls back to deterministic rules so local development still works.

In the desktop runtime, LLM memory formation is enabled by default but runs asynchronously for ordinary conversation. Inputs that explicitly ask the agent to remember something, such as `记住` or `remember this`, force synchronous memory formation before the reply.

## Safety

- API keys stay outside source code.
- `.env` and `.env.*` are ignored by Git.
- LLM output is normalized before persistence.
- Future work should add stricter schema validation, retry policy, cost accounting, and audit logs.
