---
status: active
updated: 2026-05-07
role: decision-record
---

# L090 - DeepSeek-Only Active Model Policy

## Decision

Active Novel Harness LLM calls use only:

- `deepseek-v4-flash`
- `deepseek-v4-pro`

Both route through provider `deepseek`. Thinking level is set per role:

- creative prose, extraction, light transforms, deterministic diagnostics:
  Flash with thinking disabled;
- guided planning discussion and cross-artifact reasoning/checker surfaces:
  Flash with thinking enabled when the role marks `thinking: true`;
- Pro is reserved for explicit judge/escalation roles where Flash thinking is
  not enough.

## Rationale

The harness is currently optimizing upstream planning methodology and
downstream traceability. Mixing Qwen, Groq, Mimo, Cerebras, OpenRouter, or
other routes into active calls confounds experiments and makes evidence harder
to interpret. The method-pack planner diagnostic exposed this directly: an
unregistered diagnostic agent fell through to the generic Qwen/Cerebras default
and produced evidence on the wrong model family.

For now, model-family stability is more valuable than provider diversity or
latency optimization.

## Implementation

- `src/models/roles.ts` maps active agent roles only to DeepSeek V4 Flash or
  DeepSeek V4 Pro.
- `src/models/roles.test.ts` has an invariant that fails if an active role
  uses a non-DeepSeek provider or any model outside the allowed set.
- `src/llm.ts` defaults unregistered `callAgent` calls to DeepSeek V4 Flash.
- `src/transport.ts` normalizes direct transport requests to the active model
  policy, so legacy provider/model values cannot silently trigger a live call
  to another model through the shared transport layer.
- Direct orchestrator and drafting fallbacks use DeepSeek defaults.

Historical registry entries, archived scripts, old docs, and retired
fine-tuning experiments may still mention other providers. Those references are
evidence/history, not active routing permission.

## Implication

Any future agent route, diagnostic, or UI-triggered LLM call must declare one
of the allowed DeepSeek routes and the intended thinking level before it is
used for evidence.
