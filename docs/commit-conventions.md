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
| `[roles]` | Model assignment changes | `[roles] Set DeepSeek V4 Flash thinking-on for state mapper` |

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

## Experiment commits

When a commit is part of a chartered experiment (fine-tune, benchmark, agent-prompt A/B), the commit body must include three extra lines so the `tuning_experiments` → git → charter trail is recoverable:

```
charter: docs/charters/<name>.md
adversary-verdict: codex=GREEN  (| opus=GREEN if second opinion ran)
experiment: #NNN
```

Rules:

1. **One agent dir per commit during an experiment.** A commit that touches `src/agents/writer/` and `src/agents/adherence-events/` cannot be attributed to either experiment cleanly. Split it.
2. **Charter commit first, code commit second.** The charter lands on `main` before any code change it motivates — this gives the charter a stable git anchor for the adversary review record.
3. **Reference the pending experiment ID, not a placeholder.** Allocate the ID with `createTuningExperiment()` before the commit; paste it into the body.
4. **Adversary verdict must be GREEN or YELLOW-with-conditions-listed.** A commit that says `adversary-verdict: RED` is a bug, not a valid experiment commit.

If the commit only edits a prompt or context file *outside* a chartered experiment (e.g. a typo fix), the three extra lines are unnecessary — but the `[agent:name]` prefix still applies so `git log src/agents/<name>/` remains a clean timeline.

## Docs Impact Rule

To keep the repo's live documentation from drifting:

1. `docs/current-state.md` is the canonical current-state source of truth.
2. If a commit changes current runtime behavior, architecture, or active methodology, it must do one of the following:
   - update `docs/current-state.md` in the same commit, or
   - include `docs-impact: none` in the commit body
3. `docs-impact: none` means the author explicitly checked that the change does not alter the live system contract.
4. Historical docs (`docs/decisions.md`, `docs/lessons-learned.md`, experiment writeups) are valuable, but they are not canonical current-state references.

Recommended body footer for non-doc-changing runtime commits:

```
docs-impact: none
```

## Superseded Documents

When a charter, plan, runbook, or living doc is replaced by a successor that earned a **new family name** (different causal question, different baseline, different metric, different scope) — most often after a RED adversary verdict — retire the predecessor by **deleting it from the working tree** and recording the supersession in `docs/decisions.md`. The active directory stays current; git preserves the history.

### Rules

1. **Delete the predecessor from the working tree.** Git keeps it at its last committed SHA; `git log --follow <path>` finds it. Do NOT leave the file in place marked `superseded`, and do NOT move it to an archive directory — either option piles up clutter an active contributor has to skip over.

2. **Successor carries a `supersedes:` frontmatter pointer** at the predecessor's ex-path. The target no longer exists on `main` — that's the point. Readers who want the RED version run `git log --follow <that-path>` and pull it from history.

3. **Record the supersession in `docs/decisions.md`** under the `## Superseded charters` section (appended chronologically — follows the existing decisions-notebook convention). Each entry contains: predecessor filename, date, one-paragraph reason (cite adversary verdict session if applicable), git SHA at which the RED version was last live on `main`, forward link to the successor.

4. **Commit the supersession as a single atomic commit** with prefix `[supersede]`. Body: what was killed, what replaced it, one-line reason, git SHA reference. Example:

   ```
   [supersede] planner-phase2-contract → planner-phase2-payoff-floor

   Killed by RED verdict from /codex:adversarial-review 2026-04-18
   (session 019da279-313c-7863-aad8-f483ff08e9d7). Successor tests
   the cheap prompt-only Floor against pre-planner-phase2-v1a
   before any schema claim.

   Last live at 6dc2fe9. Successor: docs/charters/planner-phase2-payoff-floor.md.
   Log entry: docs/decisions.md §Superseded-charters.

   docs-impact: none
   ```

### When NOT to supersede

- **Typo fix, numeric update, rubric tightening** — edit in place. Same path, same family name.
- **Doc retires with no replacement** — delete, record under `## Retired docs` in `decisions.md` with the reason. No successor pointer because there's no successor.
- **Plan / runbook whose charter is deferred but reactivatable** — mark `status: deferred` in-place with a one-line pointer to what conditions would reactivate it. Don't delete.

### Why in-place-with-markers and archive-directory were both rejected

- **In-place-with-`status: superseded`** pollutes the active directory with dead charters; every contributor has to mentally skip past RED predecessors to find what's live.
- **Archive directory** (tried 2026-04-18, abandoned same day) duplicates git's job, adds a 3-step ritual per supersession event, and already produced stale cross-references the first time it was applied. See `docs/decisions.md` §Superseded-charters for the retrospective.

### Status taxonomy

Living docs that exist in the working tree carry a `status` frontmatter field:

| value | meaning |
|---|---|
| `active` | canonical current truth, in effect |
| `frozen-YYYY-MM-DD` | artifact intentionally frozen (eval specs, reference bundles); changes require a v2 artifact |
| `proposed` | charter not yet adversary-reviewed |
| `revise-required` | adversary review returned RED or YELLOW; awaiting SUPERSEDE or revise decision |
| `deferred` | paused; may reactivate later under stated conditions |
| `template` / `example` | reference material |
| `work-order` | direction document for the implementer |

Superseded and retired docs have no `status:` because they no longer exist in the working tree — they live only in git history and in the `decisions.md` log.
