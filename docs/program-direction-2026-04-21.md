---
status: active
kind: program-direction
date: 2026-04-21
supersedes: various "Salvatore voice LoRA is the flagship fine-tune" framings throughout CLAUDE.md + decisions.md
---

# Program Direction — Post-LoRA-Pivot

Captures the strategic framing that emerged from the 2026-04-21 arc.
Neither a decision nor a retrospective — those live elsewhere. This
is the program's **forward-looking research thesis** as of late
2026-04-21, after:

- 9-round `arm-b-detector-preflight` cycle → meta-consult pivot
- `arm-b-direct-pairwise` (CAUTION 11-9)
- `arm-d-writer-upgrade` (directional DeepSeek ≈ Salvatore with
  distributional advantages)
- `voice-shaping-ablation-v1` (FLAT — bare DeepSeek already near ceiling)

Related canonical docs: `docs/decisions.md` (the formal decisions),
`docs/retrospectives/2026-04-21-lora-track-evidence.md` (the
evidence narrative), `CLAUDE.md` (the architectural overview —
already updated).

## The thesis in one paragraph

Prose quality at DeepSeek V3.2 scale is **not primarily a
voice-imitation problem** — bare DeepSeek is already close to the
Salvatore reference distribution on most voice-shape axes. Prose
quality IS a problem of: (a) **world context richness** — does the
writer see enough state about the world it's writing in; (b)
**character interactivity** — do characters sound distinct from each
other within a beat; (c) **hallucination suppression** — are the
checker gates tight enough to catch detectable failures. The harness
invests in those three levers via prompt/pipeline work, not via
weight-level voice training.

## Three lever families, ordered by expected ROI

### 1. World context richness (highest-ROI, most-unshipped levers)

The 20 beats in `voice-shaping-ablation-v1` used compact-mode beat
context: per-character snapshots (Voice/Drives/Avoids/Conflict +
exampleLines), transition bridge, landing target, resolved
references, setting. **Not yet shipped:**

- **Reader-info state tracker** — what the reader has been shown
  vs what any given character knows. Currently the writer only sees
  `characterStates.doesNotKnow` per-character; there's no unified
  "reader has seen X, Y, Z" state. Named in CLAUDE.md strategic
  direction.
- **World-expansion budget per chapter** — today's world_bible
  compact-mode excerpts are trivial (just names). Dumping the whole
  bible would bloat every beat. A per-chapter budget (e.g., 3–5 KB
  of relevant entities, selected by beat.description entity match)
  is the right shape. Exists in partial form via
  `beat-entity-list-v1` (surfaces entity NAMES to the checker; not
  full descriptions to the writer).
- **Prior-beat establishedFacts in context** — currently the
  writer sees `outline.establishedFacts` via the reference resolver,
  but not cumulatively from prior beats in the same novel. `getFactsUpToChapter`
  exists but isn't threaded into `buildBeatContext`.

**Measurement:** each new context lever runs through the decomposed
audit (adherence + halluc-ungrounded + halluc-leak + distinctness
pass rate + voice-shape metrics). Voice-shape shouldn't regress
beyond 1-sigma. Adherence shouldn't degrade >5pt.

### 2. Character interactivity (distinctness-targeted work)

`voice-shaping-ablation-v1` tested D3 (character voice directives)
on voice-shape metrics — FLAT because metrics measure rhythm not
differentiation. The charter's deferred distinctness audit runs in
`character-distinctness-audit-v1` (proposed 2026-04-21) on the same
80 rows. Answers whether D3's directive-heavy prompt measurably
differentiates character voices within a beat.

Follow-on levers if D3 clears:
- **Per-character context passes** — generate prose character-by-
  character in sequence rather than all at once; each character's
  generation sees ONLY its own speaker profile to enforce
  differentiation.
- **Signature phrasing extraction** — pull habitual constructions
  from `exampleLines` into explicit "use one of these this beat"
  directives per character.
- **Register locking** — pin a formal/vernacular/figurative tier
  per character at novel-concept time; enforce via retry if
  violated.

### 3. Checker discipline (already strong, keep tight)

Current stack: `adherence-events` (W&B 14B SFT), `chapter-plan-checker`
(DeepSeek base), `halluc-ungrounded-v2` + `halluc-leak-salvatore-v1`
+ regex-OR-combine, `continuity-v2` (W&B 14B SFT), `quality-detectors`
(repetition, underlength, redraft gate), `beat-entity-list-v1`
context-surface alignment.

**Known gaps:**
- Each new context lever from family (1) changes the writer's input
  distribution; calibration of each checker against the new shape
  needs revalidation (see the detector-version caveat in arm-b-preflight
  round-9 for the pattern).
- `halluc-leak-salvatore` is Salvatore-specific. If we retire the
  Salvatore LoRA, leak detection of a DIFFERENT kind may be needed —
  generic "ungrounded invented-entity" detection already exists via
  halluc-ungrounded; the leak adapter is deadweight on non-Salvatore
  routes.
- Continuity checker was deprioritized per `docs/decisions.md` —
  revisit whether it should be re-armed for the new context-engineering
  focus.

**No new checker work proposed right now.** The checker layer is
tight; the leverage is in what we GIVE the writer (family 1) and
how we ASK for character interactivity (family 2).

## What's NOT in this program direction

- Voice-shape micro-optimization. FLAT verdict says the lever is
  capped. Don't re-charter prompt-level voice-imitation work.
- Further Salvatore-adjacent fine-tune levers (v5 corpus expansion,
  archetype tags, etc.). Frozen per decisions.md.
- Howard primer revival. Retired 2026-04-16; evidence has not changed.
- Broader model-replacement search (Sonnet/Opus/GPT-5.4 as writer).
  DeepSeek V3.2 is near-ceiling on voice-shape; context-engineering
  gains likely don't depend on a more expensive writer. Reconsider
  only if context-engineering alone hits a clear ceiling.

## How the program executes

The user's 2026-04-21 framing: "run massive prompt oriented and
coding oriented tests using deepseek as the writing driver for just
a few dollars." This program operationalizes that by:

1. Each context lever gets a charter. Charters are lightweight —
   one Codex review pass, no 9-round towers. The `arm-b-direct-pairwise`
   / `arm-d-writer-upgrade` / `voice-shaping-ablation` pattern is the
   template.
2. Measurement is the decomposed audit, NOT pairwise. Voice-shape +
   adherence + halluc + distinctness + defects. All checker-layer;
   no holistic LLM preference judging (per
   `docs/lessons-learned.md` "AI-judge pairwise is bias-confounded
   when length correlates with arm identity").
3. **Autonomous exploration:** the context-lever space is large
   enough that hand-charting each arm is a bottleneck. See
   `docs/designs/autonomous-context-loop.md` (2026-04-21 design) for
   an LLM-driven hyperparameter-search loop over context
   configurations.

## Near-term decision tree

| Next step | Triggered by | Cost |
|---|---|---|
| Ship bare DeepSeek to fantasy route, full-novel validation | If no blocker; default path | 1 full-novel run (~$0.05) |
| `character-distinctness-audit-v1` on existing 80 rows | Independent; cheap | ~$0.30, ~30 min |
| Autonomous context-loop POC (see design doc) | If user approves design + budget | ~$1–5, persistent infra |
| Reader-info state tracker charter + build | When autonomous-loop first proposes it OR explicit prioritization | ~4h dev, ~$0.05 measurement |
| Salvatore v4 in production unchanged | Default until the full-novel DeepSeek validation completes | $0 |

This doc is the **answer key** for "what should I start on next
session." Read this before opening any charter; charter against it.
