# ADR 0006: Agent and LLM provider adapters

- Status: Accepted
- Date: 2026-11-23

## Context

Models, gateways (e.g. Midas) and agent SDKs change quickly. The system must run without
paid credentials in development and CI, and must never present mock output as real AI.

## Decision

- `AgentRuntime` (= Planning + Coding + Validation + Repair agent interfaces) in
  `packages/agent-core`; one deterministic `MockAgentRuntime` today.
- `LlmProvider` in `packages/llm-adapters` with adapters for any OpenAI-compatible
  endpoint (OpenAI, Midas `deepseek-v4`), Anthropic, and a mock; selected by
  `LLM_PROVIDER`, constructed only with credentials. Implemented with `fetch` (no SDK
  lock-in), bounded time/size, retry-classified errors.
- `RequirementAnalyzer` uses the LLM when configured, otherwise a template matcher; all
  outputs carry provenance (`analysis.analyzer`, `isMock`) set by the server.
- All LLM calls go through `LlmUsageService` (rate limits, concurrency cap, usage records).

## Consequences

- New providers/agents are additive; tests never need network or keys.
- Model output is untrusted input and must always pass schema validation.
- A provider-backed coding agent is deferred until a real sandbox exists (ADR 0005).
