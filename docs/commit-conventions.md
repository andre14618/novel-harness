---
status: active
verified: 2026-04-02
---

# Commit Conventions

Every change gets its own commit with explicit context. The prefix indicates what changed.

## Prefixes

| Prefix | When | Example |
|--------|------|---------|
| `[agent:name]` | Prompt/config change to an agent | `[agent:fact-extractor] completeness 3.0 → 4.7 (+1.7)` |
| `[agent:name] revert:` | Reverted attempt (automated loop) | `[agent:writer] revert: telling 4.0 → 4.2 (+0.2)` |
| `[infra]` | Scripts, DB schema, tooling | `[infra] Add filtering to all benchmarks` |
| `[baseline]` | Benchmark baseline runs | `[baseline] Establish planning baselines` |
| `[roles]` | Model assignment changes | `[roles] Set DeepSeek V3.2 as pairwise judge` |

## Body format

```
[prefix] One-line summary with scores if applicable

What changed and why (1-3 lines).

benchmark/dimension: score | N samples x N runs
experiment: #ID
improver: model-name (if automated)
```

## Automated commits

The improvement loop (`scripts/improve-loop.ts`) auto-commits:
- Each **kept** change with scores and delta
- Each **reverted** attempt so failures are visible in history

`git log src/agents/*/prompt.md` shows the full trail.
