---
status: retrospective
updated: 2026-04-20
duration: ~8h
commits: 18
subagents_spawned: 14
wall_clock_min: 480
codex_reviews: 3
rework_passes: 2
bugs_caught_by_codex: 0
bugs_caught_by_preflight: 0
bugs_escaped_to_prod: 0
preflight_false_positives: 0
---

# halluc-ungrounded V1 + leak Rung 0 + V1a pilot — 2026-04-20

## 1. What shipped

Three distinct quality-layer interventions landed in one session.
(a) **beat-entity-list V1** promoted to default for the
`halluc-ungrounded` checker — fire rate dropped 44.9% → 28.9% on
fantasy-debt with 87.5% precision (charter
`docs/charters/beat-entity-list-v1.md`, exp #254, commits `9b646e3`
→ `620dc71`). (b) **halluc-leak-salvatore Rung 0** regex OR-combine
shipped at inference — +31.6% recall over the v1 adapter alone, ≥95%
precision on regex-only catches, zero SFT spend (scoping
`docs/scoping/halluc-leak-salvatore-v2.md` §5, report
`docs/rung-0-regex-ceiling-results.md`, commit `cc57752`).
(c) **V1a payoff-floor mini-pilot** ran (2 of 4 arms, charter
scoping error) with ITERATE verdict — mean paired Δ retry_ratio −0.03
suggests V1a's schema-level requiredPayoffs is the causal lever rather
than a prompt-only floor (`docs/pp2-floor-pilot-results.md`, exp
#256). Two non-shipping artifacts produced: salvatore-v5-stripped
ablation scoped and parked on 4 user-decision gates, and a component
isolation-testing methodology proposal (commit `7794735`).

## 2. Architectural iterations with supersession chains

### Chain A: "halluc-leak-salvatore has 0 production fires" → query-bug → 7% real rate → Rung 0 regex OR-combine

- **Initial claim** (earlier in session): "leak adapter fired 0 times on the charter seed despite 7+ Salvatore-corpus names" — documented in the initial beat-entity-list V1 decision entry.
- **Problem discovered**: aggregate query filtered `response_content LIKE '%pass":false%'` but the leak adapter uses `{"has_leak":true,"leaks":[...]}`. Schema mismatch silently dropped every fire.
- **First correction** (commit `78d1d01`): ran per-entity breakdown, got 7.1% V0 / 6.3% V1, identified partial recall on canonical FR names (Waterdeep 0/4, Baldur's Gate 1/4).
- **Superseded by** (commit `cc57752`): Rung 0 regex OR-combine at inference. 59-token list closed +50-beat recall gap for $0.
- **Lesson**: "Verify output schema before asserting a zero-fire baseline" — elevated to `docs/lessons-learned.md`. A one-row raw-payload query before aggregate math would have caught it.

### Chain B: V0 baseline generated under broken request_json encoding → kill and re-run → request_json fix commit

- **Initial approach**: launched V0 fantasy-debt run at commit `9ec681f` expecting `groundedSources` JSONB payloads queryable via `#>` path operators for the mechanism-falsifier.
- **Problem discovered** mid-run: `logLLMCall` was `JSON.stringify`-wrapping `request_json` before passing to Bun.sql's tagged template (which auto-serializes JSONB). Result: Postgres stored the object as a JSONB *string type* — all path operators returned NULL. Latent since sql/018.
- **Superseded by** (commit `ff555bc`): one-line fix — removed the `JSON.stringify`. Killed V0 novel mid-run, redeployed, relaunched. Lost ~15 min of V0 prose but telemetry format was the primary goal.
- **Lesson**: when a DB column is JSONB-typed and your ORM auto-serializes, wrapping in `JSON.stringify` double-encodes silently. The other callers defensively re-parsed strings at read time, which masked the bug for months. Detect via: `SELECT jsonb_typeof(col) FROM t LIMIT 1` — string vs object tells you which path is live.

### Chain C: V1a pilot scoped as 3 seeds × 2 arms → should have been 4 arms → ITERATE verdict partially tainted

- **Initial approach**: briefed the launch subagent as "3 seeds × 2 arms × 5 chapters" for the V1a payoff-floor pilot.
- **Problem discovered** at analysis time: charter §4 actually specifies a 4-arm ladder (`baseline`, `prompt`, `extractor`, `mainv1a`). My launch summary collapsed it to the 2 primary causal arms; the subagent followed instructions rather than the charter.
- **Superseded by** (next-session action): the scoping error is captured in `docs/lessons-learned.md` "Don't narrow a charter's baseline ladder at launch time without a written reason." Next-session queue in `docs/next-session-plan.md` runs `extractor` + `mainv1a` on the same 3 seeds before expanding.
- **Lesson**: reproduce the charter's ladder **verbatim** in the launch brief. If narrowing, write the reason down and commit it. Quick-summary-over-charter is a charter-fidelity class-of-bug.

## 3. Codex back-and-forth exchanges

### Exchange 1 — v5-stripped training pathway decision

- **Thread**: `a6f2ec681a29e9d7e` (`codex:codex-rescue` with `--model gpt-5.4 --effort high`)
- **Original claim**: 4 open design gates (brief-side stripping scope, placeholder strategy, sequencing with conditioning-floor, rename-augmentation interaction) needed a path decision before SFT submission.
- **Codex found**: a3 / b1 / c3 / d2 with specific repo-file citations (`scripts/finetune/format-salvatore-v4-sft.py`, `salvatore-rename-pool.json`, `docs/charters/salvatore-distinctness-conditioning-floor.md`).
- **My disagreement**: I pushed back on (c) — Codex wanted to merge conditioning-floor into the v5-stripped eval suite (c3); I argued c2 (sequence) is cheaper because conditioning-floor is $0 and informs whether v5 retraining is even the right question.
- **Sufficient?**: deferred to next session — user adopted c2, remaining gates a3/b1/d2 still open for explicit confirmation.

### Exchange 2 — component-isolation testing methodology

- **Thread**: `ad2893722314bd376` (codex:codex-rescue)
- **Original claim**: we've been measuring single-component changes with full end-to-end novel runs; that's expensive for what's often a replayable check.
- **Codex produced**: `docs/component-isolation-testing.md` (1080 words, 8 sections, status: proposed) — concrete replay / plan-diff / beat-rewriter patterns, 3 anti-patterns where isolation misleads.
- **Sufficient?**: landed as commit `7794735` with status `proposed`. Next step is adversary review + pilot a replay harness on a real change.

### Exchange 3 — conditioning-floor scorer implementation

- **Thread**: `a9dfc0d6e9115ba87` → `bc1biuhtt` (nested codex-cli invocation)
- **Original claim**: 4 open TODOs in `scripts/evals/run-salvatore-distinctness-v1.ts` block the charter's §11 readiness gate.
- **Codex found**: in flight at session close — files written (scorer + 4 arm-configs + test file) but uncommitted. Session needs a follow-up review pass before landing.
- **Sufficient?**: ongoing — next session opens with reviewing Codex's diff and deciding whether to land / iterate.

## 4. Class-of-bug patterns

- **Schema-mismatch filter in aggregate query** — seen at 1 site (halluc-leak-salvatore "0 fires"). The adapter's `has_leak` vs ungrounded's `pass:false`. Mitigation: read one raw payload before trusting aggregate math. Elevate to `docs/patterns/schema-mismatch-in-aggregate-query.md` if it recurs ≥1 more time.
- **Double-encoded JSONB via `JSON.stringify` + tagged-template auto-serialize** — seen at 1 site (`logLLMCall`). Every subsequent reader silently re-parsed on read, which masked detection. Mitigation: any JSONB write-site should have a `jsonb_typeof` sanity query run at least once against a seeded row.
- **Charter-fidelity drift at launch briefing** — seen at 1 site (V1a pilot). Launch summary collapsed 4 arms to 2 without a written rationale. Mitigation: the launch-brief template needs a `ladder_verbatim: true | "why narrowed: ..."` field.
- **Persistent-state mutation without registered cleanup** — seen at 1 site (V1a pilot's `run-pp2-floor.ts` mutating `beat-expansion-system.md` in-place on `--arm prompt`, no restore). Mitigation: register cleanup at the same site that mutates, OR emit a session-end restore hint.
- **Parallel `sleep N; ssh` tool-call pattern** — seen at 1 site during V1a prompt-arm launch. The parallel-tool-call orchestrator SIGTERMs hung siblings. Captured in memory `feedback_parallel_ssh_launches.md`.

## 5. Process observations

Three patterns in how the work actually got done:

(1) **Parallel Sonnet subagent lift-off**: the beat-entity-list charter's implementation + V1a pilot scoping + leak v2 scoping + ungrounded v4 harvest scoping + salvatore-v5-stripped scoping all ran as parallel Sonnet subagents against Codex-shaped prompts. This compressed what would have been a 2-day sequential workload into a single afternoon, with only one subagent failure (V1a pilot monitor watchdog, recovered by taking over manually). Per memory `feedback_parallel_sonnet_subagents.md`, default-to-parallel is paying off.

(2) **Codex is the adversary layer, not the implementation layer — except when it is**: for design questions (v5-stripped pathway, component-isolation methodology) Codex's second-opinion value is highest. For pure implementation against a narrow contract (conditioning-floor scorer), codex-rescue behaves as an autonomous coder. The distinction is useful — ask Codex to *review* when the question is "is this right?"; ask Codex to *implement* when the contract is frozen and the work is mechanical.

(3) **Small, atomic commits compound well with memory**. 18 commits this session, each with one concern per commit. Enabled auto-memory reads (recalling `feedback_pilot_checkers_in_production.md`, `feedback_wandb_lora_model_field.md`, `feedback_codex_gpt54_subagents.md` at relevant decision points) to fire cleanly. A monolithic "big session commit" would lose the decision-level granularity that memory keys off.

## 6. Open questions / next-session focus

See `docs/next-session-plan-2026-04-21.md` for the full queue. Short version:

1. **Review + land Codex's conditioning-floor scorer** (uncommitted at
   `scripts/evals/run-salvatore-distinctness-v1.ts` + `docs/evals/arm-configs/`).
2. **Codex adversary re-review** of
   `docs/charters/salvatore-distinctness-conditioning-floor.md` after
   scorer lands.
3. **Run conditioning-floor 3-arm eval** if GREEN.
4. **Complete V1a pilot** by running the missing `extractor` and
   `mainv1a` arms on the same 3 seeds (not expanding to 6 yet).
5. **halluc-leak-salvatore regex FN widen pass** — possessive-suffix
   tolerance + "dark elf" variants (~1h, $0).
6. **Resolve v5-stripped design gates** if conditioning-floor verdict
   is in hand.

**If you're reading this on the next session, start here:** read
`docs/pp2-floor-pilot-results.md` first (the V1a pilot has partial
data and a scoping error flag), then `docs/rung-0-regex-ceiling-results.md`
(to understand why `halluc-leak-salvatore` now OR-combines regex +
adapter), then `docs/next-session-plan.md` for the prioritized queue.
The Codex conditioning-floor scorer work is uncommitted — decide
whether to land or iterate before running the 3-arm eval.
