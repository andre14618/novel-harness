---
status: proposal
date: 2026-05-10
role: spend-plan
inputs: external-session-tier-list (no repo access)
---

# Quality Acceleration Spend Plan

External response to "how do we trade subscription / API spend directly for
faster, higher-quality artifacts in this harness." This document does two
things:

1. Pushes back, item by item, on the external tier list. Several Tier 1
   items don't apply or are explicitly retired in this repo. Several Tier 2
   items already exist as standing rules.
2. Codifies the spend levers that actually move quality given current state
   (L100 POC lane, scene-first migration in flight, DeepSeek-only runtime,
   subagent-heavy engineering).

The goal is **dollars → throughput → reader-visible artifact**, not
"infrastructure that compounds for twelve months." The repo is closer to a
near-production POC than a greenfield system; spending order is different.

---

## Why the external take needs adjustment

The external session was working blind. Before going line-by-line, the four
load-bearing assumptions it baked in:

| External assumption | Actual state |
| --- | --- |
| Anthropic Claude is the runtime LLM | **DeepSeek V4 Flash is the runtime.** L090 caps runtime to DeepSeek V4 Flash / V4 Pro only. Anthropic Claude appears in the engineering loop (subagents, reviews) but never on the per-chapter critical path. Tier-1 "Anthropic prompt cache optimization" therefore doesn't apply to chapter cost. |
| Voice LoRA / Writer Pack training is the next step | **Voice LoRA / Writer Pack is retired** (CLAUDE.md Strategic Constraints; L090; memory: project_fine_tune_free_direction). New writer/checker fine-tunes are not the default path. Spending here would re-open a closed lane. |
| Calibrated eval infrastructure needs to be built | **It exists** — `eval_briefs` + `eval_results` tables, `provenance-report.ts` CLI, full adapter lineage (memory: project_eval_infrastructure). The gap is *which* judges get calibrated, not whether infra exists. |
| "K=3 sweeps" need to be introduced | **Already mandatory** — `docs/experiment-design-rules.md` §2 (baseline ladder + production-model anchor + third-anchor when cheap). Calling it out as a Tier-2 item would be re-stating standing policy. |

These four corrections collapse roughly half the original tier list into
"already there" or "explicitly chosen against." That isn't a criticism of
the external session — it's the cost of advising without source access.

The repo's current critical path (per `docs/sessions/lane-queue.md`):

- L100 POC acceleration lane is the primary frame: build vertical
  reviewable artifacts under `poc/`, defer blocking checkers, spend cheap
  model calls on evidence, **don't change production defaults**.
- Production scene-first migration S1 is **deferred until the POC yields
  reader-visible evidence**. Reader-visible evidence is the unlock; nothing
  else.
- The active artifact (running on LXC at the moment this doc lands) is
  `poc/scene-first-novella/` — concept → planning → drafting → diagnostics
  → static HTML, default-off scene-first flags, P3 fixture.

A spend plan that ignores this state would buy infra for a system that
doesn't need it yet.

---

## Item-by-item review

### Tier 1 — infrastructure that compounds

| External item | Verdict | Note |
| --- | --- | --- |
| Anthropic prompt caching optimization | **Reject for runtime; partial yes for engineering.** Runtime is DeepSeek V4 Flash, which already exposes implicit cache hit tokens (`prompt_cache_hit_tokens`, tracked in `src/transport.ts`). Howard primer cache hit was historically ~94%. Where Anthropic *does* fire is the engineering loop — Claude Code subagents, Codex reviews. Default subagent traffic already exploits Anthropic prompt cache via the harness; explicit optimization is a small marginal lever and not Tier 1. |
| Batch API for non-time-sensitive work | **Conditional yes for subagent/eval work; no for runtime.** DeepSeek doesn't expose a 50%-off batch endpoint the way Anthropic does, so this doesn't help per-chapter cost. Where it helps: large Sonnet teacher labeling runs and bulk research/eval shaped as Anthropic batch jobs. Concrete: any future >100-prompt judge labeling round. Not the bottleneck right now. |
| Voice LoRA / Writer Pack training | **Reject.** Retired direction (CLAUDE.md Strategic Constraints; memory: project_fine_tune_free_direction; L090). Re-opening would require a new decision record and explicit re-authorization. The strategic bet is fine-tune-free + deterministic guards + scoped V4 Flash calls. |
| Calibrated eval infrastructure | **Already exists; redirect the spend.** The infra is built. The actual open question is *which* judges to calibrate. Memory `feedback_dont_calibrate_noisy_llm_checkers` rules out chasing TP/FP panels for noisy LLM continuity / hallucination / grayzone checkers — that's the wrong direction. The right calibration target is the narrow, evidence-first judges in `docs/research/opus-semantic-judge-plan.md` (endpoint-landing, scene-dramaturgy, character-agency). Spend goes there, not generic per-checker P/R. |

### Tier 2 — experimentation parallelism

| External item | Verdict | Note |
| --- | --- | --- |
| K=3 sweeps on every claim | **Already mandatory.** `docs/experiment-design-rules.md` §2 + CLAUDE.md primary-lane rule. No new spend; no new policy. |
| Multi-arm primary-lane experiments | **Already mandatory.** "A primary lane must declare its baseline, changed runtime lever, feedback signal, stop gate, and escalation rule before live validation." The standing rule is *one* primary lane; the external proposal's "spend heavily within that lane" is what we already do (writer-arms list in `test-drafting-isolated`). |
| Multi-model parallel evaluation | **Conditional yes — diagnostic only.** Active runtime is DeepSeek-only per L090. *Off-policy* multi-model eval against produced artifacts (e.g., Opus 4.7 vs Sonnet 4.6 vs DeepSeek scoring the same scenes) is permitted and useful as a diagnostic anchor. Useful when paired with the narrow judge plan above; not useful as a per-beat router experiment until L090 is reopened. |
| Lint baseline calibration vs published genre prose | **Yes — concrete and cheap.** Corpus pipeline already supports this (`docs/corpus-pipeline.md`, Salvatore + 2,470 pairs). The "silence stretched 42×" failure mode is real (lint regex pulls vs distribution thresholds). One-shot calibration over a 50-novel fantasy corpus → distribution thresholds for each lint pattern. Would directly retire several phantom-failure lint blockers. Recommend as a small, bounded support lane. |
| Synthetic reader-persona testing | **Hard skepticism.** The Plan-A bias incident (memory: feedback_priming_suppression_ab + lane-queue notes on blind semantic pairwise judge — `0/18` after AB/BA swap) showed that LLM-pairwise judges over prose are wildly position-biased. Don't add another LLM-eval surface until the existing semantic-judge plan ships and proves discernment. Even then, treat synthetic readers as one diagnostic input, not a promotion gate. |

### Tier 3 — production volume

| External item | Verdict | Note |
| --- | --- | --- |
| K=3 candidate generation per chapter | **Yes, scoped to writer-arm A/B inside POC.** Maps cleanly onto `test-drafting-isolated --writer-arms`. Spend is bounded; arms already exist (`baseline`, `scene-call-v1`, `id-suppress`, `contract-render-only`). Pick-best post-hoc once the diagnostic judges are calibrated. |
| Parallel chapter generation | **Premature.** Royal Road serial launch is not on the active critical path. Defer until production-default scene-first migration ships. |
| ElevenLabs / Hailuo voice scaling | **Out of scope.** Audiobook pipeline isn't an active lane. |

### Tier 4 — AI content channel amplification

All four (image, video, music, voice cloning) — **out of scope** for the
current quality lane. Re-evaluate post production-migration.

### Discipline anchors

All four (stop gates, single primary lane, telemetry payload extensions,
schema-level invariants) are already standing rules in
`docs/experiment-design-rules.md`, CLAUDE.md, and `docs/invariants.md`. No
new spend; tighten enforcement, don't reinvent.

---

## What actually moves quality fastest given current state

Ranked by structural ROI **inside the L100 POC lane** and the
deferred-but-imminent scene-first production migration.

### Lane A — POC artifact iteration (fastest reader-visible feedback)

The POC packet that just shipped (`poc/scene-first-novella/run.ts +
diagnostics.ts + render-html.ts`) is a one-command pipeline. Quality moves
when this runs *more often, on more fixtures, with more arms, reviewed
faster.*

- **Fixture breadth.** P3 (clean attribution) is the first run. Adding P1
  (over-target), P2 (undershoot), P4 (real frozen plan) gives four reader
  artifacts side-by-side. Marginal cost is one more LXC run per fixture
  (~$0.10 each at current cache hit rates). High signal: shows whether the
  scene-first writer is robust across attribution conditions.
- **Writer-arm matrix on the POC.** Wire the existing `--writer-arms` set
  into the POC runner so a single output dir contains baseline + scene-call
  + contract-render + id-suppress prose for the same plan. Cost ~4× per
  fixture. Diff-able prose is the single fastest way to see whether
  scene-first beats baseline.
- **Diagnostic judge ship.** The three-judge plan (endpoint-landing /
  scene-dramaturgy / character-agency) is already running post-hoc in
  `poc/scene-first-novella/diagnostics.ts` but uncalibrated. Calibration =
  20-row gold panel + judge self-consistency at gold ≥ 0.85 (per memory:
  feedback_gold_stability_first). Once green, the POC artifact carries
  defensible verdicts, not raw prose.

**Cost band: $5–30 per full POC sweep across fixtures × arms. Concrete
budget: $50/week for POC iteration. This is the highest-return spend.**

### Lane B — narrow judge calibration (unlocks promotion gates)

`docs/research/opus-semantic-judge-plan.md` already lays out the shape:
single-excerpt, single-dimension, evidence-first, narrow rubric (memory:
feedback_gold_stability_first). The infrastructure (eval_briefs +
eval_results) exists.

What's missing:

- 20-row gold panels for endpoint-landing, scene-dramaturgy, and
  character-agency, labeled by the operator (or a Sonnet teacher subagent
  with operator spot-check).
- Judge self-consistency runs (calibration anchor + production emit
  granularity) per the gold-stability-first memory.
- Promotion gate: J ≥ 0.85 at both granularities OR data-only binary
  collapse before re-labeling.

**Cost band: ~$2–5 in V4 Flash per gold panel calibration round; ~$10–30
in Opus/Sonnet subagent labels for gold construction. Bounded total well
under $100. Output: defensible POC verdicts.**

### Lane C — engineering throughput via subagents (the real "trade subscription for code")

This is the answer to "trade subscription/API costs directly for building
up this repo." The repo is single-operator-driven; the bottleneck is human
review bandwidth, not LLM spend.

Standing patterns to lean into harder:

- **Parallel Sonnet subagents for decomposable implementation** (memory:
  feedback_parallel_sonnet_subagents). Default to multiple, not one.
- **Codex `gpt-5.5 --effort high` for review and adversarial consensus**
  (memory: feedback_codex_gpt54_subagents). Routine review at coherent
  stop gates.
- **Documentation subagent in parallel with next work** (memory:
  feedback_documentation_subagent). Keeps human oriented without
  re-reading commits.
- **Codex consensus → proceed without asking** (memory:
  feedback_act_on_codex_consensus). Removes a serialization point.
- **Schedule wakeups during long LXC runs** instead of idling. The current
  POC run alternates wakeups with productive parallel work (this doc is an
  example).

What this does NOT mean: building a custom autonomous coding supervisor
inside the repo. CLAUDE.md "Engineering orchestration boundary" forbids
that — Claude Code / OpenCode is the engineering layer.

**Cost band: subagent + Codex spend ~$1–5 per substantive ticket;
~$30–80/week if every shipped commit gets review. Buys human-equivalent
review-loop speed without adding internal infrastructure.**

### Lane D — lint distribution calibration (one-shot, retires phantom failures)

Concrete and bounded. Pull lint pattern frequency stats over a 50-novel
fantasy / litRPG corpus; replace hard-coded regex caps with corpus-derived
thresholds. The Salvatore corpus (2,470 pairs) is already in place; pulling
50 more public-domain or owned-corpus novels is cheap. Memory:
feedback_lint_sourcing — patterns must be researched and cited; this lane
*is* that citation.

**Cost band: one bounded engineering ticket; LLM spend negligible. Output:
fewer phantom blockers in production drafting.**

### Lane E — world-bible / canon depth (architectural, deferred but compounding)

Per memory `project_world_bible_architecture_priority` (2026-05-03
direction): deep evolving world/character bibles + scoped context >
checker tightening. Halluc-ungrounded measured at 11% TP / 71% FP; demote
to warning, don't propose whitelist fixes.

This is the genuinely Tier-1 architectural lane in the external proposal's
spirit, but it isn't framed as a spend lever — it's an engineering
direction. Spend = engineering subagent capacity (Lane C) pointed at the
canon/world-bible service layer once the POC clears.

**Defer until POC yields evidence; then resume as the next architectural
lane.**

---

## Codified autonomous-improvement loop

Translates "subscription + API spend → repo improvements" into a repeatable
cycle. Each turn of the loop produces a committed artifact. The loop runs
without operator approval inside the cost autonomy band defined in
CLAUDE.md ("runtime actions costing under $2 per run proceed without
asking" + standing $26 overnight budget cap).

```
┌────────────────────────────────────────────────────────────────┐
│ 0. Pull next item from docs/sessions/lane-queue.md §Next       │
│    Skip blocked items; respect "don't combine lanes."          │
├────────────────────────────────────────────────────────────────┤
│ 1. Session-start contract (docs/session-start-contract.md):    │
│    goal + why + signal + stop gates. <$2 = proceed.            │
├────────────────────────────────────────────────────────────────┤
│ 2. Implement                                                   │
│    - Decomposable? → fan out parallel Sonnet subagents.        │
│    - Architectural? → captain-loop with Codex review.          │
│    - One-shot fix? → direct Edit + Bash.                       │
├────────────────────────────────────────────────────────────────┤
│ 3. Verify (the narrowest test that bites first):               │
│    - Unit / typecheck → bunx tsc --noEmit; bun test <file>     │
│    - Integration → fixture replay or LXC smoke                 │
│    - UI → Playwright MCP gate (CLAUDE.md UI Work Gate)         │
├────────────────────────────────────────────────────────────────┤
│ 4. Adversarial review at coherent stop gate:                   │
│    Codex `gpt-5.5 --effort high` (memory: codex SOP).          │
│    Consensus → proceed. Disagreement → reconcile in same loop. │
├────────────────────────────────────────────────────────────────┤
│ 5. Commit (atomic, one concern). Pre-authorized.               │
├────────────────────────────────────────────────────────────────┤
│ 6. Docs sweep (parallel subagent permitted):                   │
│    current-state.md / decisions/LNNN / lessons-learned /       │
│    todo.md / lane-queue advance / experiment row.              │
├────────────────────────────────────────────────────────────────┤
│ 7. Background runs → ScheduleWakeup, not idle. Pick up the     │
│    next §Next item while LXC works.                            │
└────────────────────────────────────────────────────────────────┘
```

Stop conditions (CLAUDE.md autonomous-loop default):
- Blocker requires human input.
- Every Next item is gated on environment access not available.
- User says stop.

Explicitly NOT stop conditions: "I just shipped a commit," "I just sent
something for review," "I summarized." Those are continuation points.

---

## Concrete spend bands (next 30 days)

| Category | Monthly band | Trigger |
| --- | --- | --- |
| LXC runtime (DeepSeek V4 Flash, runtime drafting + diagnostics) | $30–120 | POC sweeps + writer-arm matrix + judge calibration |
| Anthropic API (subagent engineering — Sonnet/Opus/Codex) | $80–250 | Per-ticket review + parallel implementation + doc subagent |
| Anthropic batch API (Sonnet teacher labeling, gold-panel construction) | $0–40 | Only when a labeling round is queued |
| Off-policy multi-model eval (Opus / Sonnet scoring artifacts) | $0–60 | Only when needed as diagnostic anchor |
| Lint corpus expansion (one-shot) | <$20 | Lane D when scheduled |
| **Total** | **$110–490 / mo** | |

This is one order of magnitude under the external proposal's $1.5–3k/mo
"foundation" band, because most of that proposal's foundation is already
built or explicitly chosen against.

The right way to scale spend is: hold this band until the POC clears its
reader-visible-evidence gate, then expand into the production-migration
lanes (S1+) at the next decision point. Spending more before that gate
buys infra for a system that hasn't validated the architectural bet yet.

---

## Items I'm rejecting outright

- Voice LoRA / Writer Pack training (retired).
- Anthropic prompt-cache optimization on the runtime path (wrong runtime).
- Generic per-checker P/R panels for noisy LLM checkers (wrong direction;
  memory: feedback_dont_calibrate_noisy_llm_checkers).
- Synthetic reader-persona promotion gates (Plan-A bias risk).
- Custom autonomous coding supervisor (CLAUDE.md engineering boundary).
- Tier-4 AI content channel work (out of scope).

## Items I'm holding for later

- Parallel chapter generation (post production migration).
- Audiobook pipeline (post production migration).
- World-bible / canon architecture lane (after POC artifact lands).

## Items to start now (in priority order)

1. **Finish the POC sweep already in flight** (P3 → diagnostics → HTML →
   commit artifact). Not a future lever; it's running.
2. **Expand POC fixtures to P1/P2/P4** once P3 lands. ~$0.50–2 per fixture
   sweep at current rates.
3. **Wire `--writer-arms` into the POC runner** so a single sweep produces
   baseline + scene-call + contract-render + id-suppress side-by-side.
4. **Build 20-row gold panels for the three diagnostic judges** and run
   self-consistency calibration. Promotion gate: J ≥ 0.85.
5. **Lint corpus expansion** (Lane D) — bounded one-shot ticket.
6. Then re-evaluate against the production scene-first migration plan
   (`docs/sessions/2026-05-10-scene-migration-plan.md` S1–S7).

---

## Pushback summary

The external session's tier list is well-structured for a greenfield AI
fiction stack. This repo isn't greenfield — it's mid-migration with active
strategic constraints (DeepSeek-only runtime, fine-tune-free direction,
world-bible-over-checkers). The right move is not to import the external
list wholesale; it's to keep the L100 POC velocity, sink spend into POC
iteration + narrow judge calibration + subagent engineering throughput,
and revisit the bigger architectural and production-volume bets *after*
the artifact gates clear.
