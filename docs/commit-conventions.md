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

When a charter, plan, runbook, or other living doc is replaced by a successor — most often because an adversary review returned RED and the revision was substantial enough to earn a new family name — the original is archived, not deleted. History stays recoverable; the active surface stays small.

### The convention

1. **Mark the original's frontmatter** with:
   ```yaml
   status: superseded
   superseded_by: docs/charters/new-name.md   # forward pointer
   archived: YYYY-MM-DD
   ```
   Preserve any existing `adversary-verdict` / `original-verdict` field. The reason for supersession should be visible in frontmatter without opening git log.

2. **Move the file to the archive directory.**
   - Charters: `docs/charters/archive/`
   - Plans / runbooks tied to a superseded or deferred charter: stay in-place with `status: deferred` if the doc is still operator-actionable after a potential future pivot, or move to the relevant archive sibling if genuinely irrelevant.

3. **Update the archive README** with a one-line entry: original filename, date archived, one-line reason, forward link to successor.

4. **Add a `supersedes:` frontmatter field to the successor** pointing back at the original. Bidirectional links survive refactoring better than one-way pointers.

5. **Commit the archive move as one atomic commit** with the `[archive]` prefix. Body names original + successor + reason. Example:

   ```
   [archive] planner-phase2-contract → planner-phase2-payoff-floor

   Original returned RED from /codex:adversarial-review 2026-04-18
   (session 019da279-…). Superseded by a counterfactual-first rewrite
   that tests the cheap prompt-only Floor against pre-planner-phase2-v1a
   before any schema claim. See docs/charters/archive/README.md.

   docs-impact: none
   ```

6. **Do NOT amend the successor in the same commit as the archive move.** The successor was already committed when it was written; the move commit should touch only the original + the archive index.

### Status taxonomy

Living docs carry a `status` frontmatter field. Valid values:

| value | meaning | lifecycle |
|---|---|---|
| `active` | canonical current truth, currently in effect | stays in place |
| `frozen-YYYY-MM-DD` | artifact intentionally frozen (eval specs, reference bundles) | stays in place; a change requires a v2 |
| `proposed` | charter not yet adversary-reviewed | stays in place |
| `revise-required` | adversary review returned RED or YELLOW | stays in place until SUPERSEDE decision |
| `superseded` | replaced by another doc | moves to `/archive/` per convention above |
| `retired` | no longer relevant, no replacement | moves to `/archive/` |
| `deferred` | paused; may reactivate | stays in place with marker |
| `template` / `example` | reference material | stays in place |
| `work-order` | direction document produced for the implementer | stays in place until executed; then `archived` |

### When to supersede vs revise

- **Revise in place** when the doc's frame stays the same and the changes are tightening rather than reframing (updated numbers, clarified metric, fixed typo). Adversary verdicts on small revisions typically don't require a new family name.
- **Supersede** when the causal question, baseline, metric, or scope has changed enough that the new charter shares only a topic — not a hypothesis — with the old one. The new family name signals the reframing.
- **Retire** when the lever being tested has been abandoned (e.g. the Howard-primer methodology) and nothing is taking its place.
