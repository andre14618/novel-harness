---
status: proposed
kind: ablation-plan
created: 2026-04-20
adapter_family: salvatore-voice-lora
experiment_hypothesis: cadence-without-vocabulary
parked_at: stripped-data-review-gate
---

# Ablation Plan — `salvatore-v5-stripped`

Cadence-without-vocabulary hypothesis: strip Salvatore corpus proper nouns from
training pairs BEFORE SFT, producing an adapter that learns sentence rhythm and
sensory restraint without encoding corpus-specific vocabulary tokens.

---

## 1. Mechanism

### Hypothesis

The v4 adapter leaks Icewind Dale vocabulary (~9% per-call fire rate, 31% of
leak-beat rewrites land corpus tokens in final prose, ~1.5 beats/30-beat novel)
because those tokens are high-frequency in training pairs and co-occur with
the cadence patterns the adapter successfully learned. The model does not
distinguish "this token is load-bearing for rhythm" from "this token is
load-bearing for plot" — it learns both together.

If we replace corpus proper nouns with generic stand-ins BEFORE training, the
adapter should learn:
- Sentence-length cadence (18.3w average with burst short lines)
- Sensory restraint (1.56/100w)
- Dialogue-tag discipline
- Physical-verb bias

...without encoding "Drizzt", "Icewind Dale", "Mithril Hall", etc. as
high-weight features.

### Specific failure modes that would falsify the mechanism

1. **Voice collapses along with vocabulary** — if Δ-sum on `salvatore-original-v1`
   worsens by >10% vs v4, it means voice lift partially rides on high-frequency
   corpus tokens (their rhythm at the token-boundary level, not just their
   semantics). Stripping would have removed a load-bearing signal.

2. **Leak persists at near-v4 rate** — if the leak adapter fires at >7% on
   v5-stripped prose, stripping did not address the root cause. Possible
   explanation: the model reconstructs corpus vocabulary from brief-side inputs
   (character names still appear in the user prompt's CHARACTERS: section unless
   briefs are also stripped — see open question §6b).

3. **[PLACE] / [ARTIFACT] placeholders survive into generated prose** — if the
   model learns to emit literal `[PLACE]` tokens, the output is broken. This
   would indicate the placeholder strategy needs to be replaced with fluid
   generic substitutes throughout (e.g., "the frozen lands" instead of `[PLACE]`).

---

## 2. Training-data prep

### Stripping rules

Applied to PROSE only (not brief). Source: `scripts/lora-data/salvatore-1988-training-pairs-fixed.jsonl` (777 pairs).

| Category | Rule | Example |
|---|---|---|
| Character names | Whole-word → generic epithet | "Drizzt" → "the dark elf"; "Bruenor" → "the dwarf king"; "Wulfgar" → "the barbarian"; "Regis" → "the halfling"; "Catti-brie" → "the ranger"; "Guenhwyvar" → "the panther"; "Entreri" → "the assassin"; "Kessell" → "the wizard" |
| Place names | Whole-word → `[PLACE]` | "Icewind Dale", "Ten-Towns", "Mithril Hall", "Bryn Shander", "Luskan", "Calimport", etc. |
| Named items / artifacts | Whole-word → `[ARTIFACT]` | "Crenshinibon", "Crystal Shard", "Aegis-fang", "Twinkle", "Icingdeath", "Taulmaril" |
| World race nouns | Whole-word → lowercase generic | "drow" → "dark elf"; "duergar" → "grey dwarf"; "verbeeg" → "moor giant"; "svirfneblin" → "deep gnome" |
| Underdark | Whole-word → "the deep" | |

Application order: items → places → world nouns → character names (longest-match
first within each category to avoid partial replacements).

### Reversibility

The strip script (`scripts/finetune/strip-salvatore-corpus.ts`) emits both
`prose_original` and `prose_stripped` in the output JSONL, plus a `strip_log`
field listing `{ token, replacement, count }` per pair. Full reconstruction of
the original is possible by replaying the log in reverse.

### Review gate

**DO NOT submit training until a human has:**

1. Diffed 20+ `prose_original` vs `prose_stripped` pairs manually. Confirm
   epithet substitutions read grammatically. Edge case watch-list:
   - Pronoun-adjacent substitutions: "Drizzt, he said" → "the dark elf, he said"
     (grammatically fine but slightly awkward — acceptable).
   - Compound token contexts: "drow ranger" → "dark elf ranger" (fine).
   - `[PLACE]`-adjacent constructions: "Ten-Towns trade" → "[PLACE] trade"
     (acceptable but review a sample).

2. Reviewed `finetune-data/salvatore-1988-v5-strip-stats.json`. Confirm
   per-token replacement counts are plausible (Drizzt should be the most
   frequent, in the hundreds; Crystal Shard in the tens).

3. Reviewed `brief_only_tokens` in the stats — corpus tokens that appear in
   briefs but not in corresponding prose. These are NOT stripped (correctly),
   but they will appear in the user prompt's CHARACTERS: section. Decision
   needed: strip briefs too, or accept that brief-side names are necessary
   planning anchors?

4. Checked that [PLACE] / [ARTIFACT] placeholders read naturally in their
   sentence contexts (sample 10 each).

---

## 3. Eval plan

### Primary voice oracle — Phase C.3 replication

Use the same eval infrastructure as v3/v4 (eval_briefs + eval_results tables,
`scripts/finetune/phase-c3-generalization.py`). Eval against:

| Set | N | Purpose |
|---|---|---|
| `salvatore-original-v1` (18 briefs) | 18 | Cross-distribution voice: original characters, original settings, no trained lore |
| held-out val (v3's 5 held-out chapters, 60 beats) | 60 | In-distribution voice |

**Primary metric: Δ-sum** — Manhattan distance from corpus baseline:
```
Δ-sum = |sent − 18.3| / 10
      + |dialogue − 0.28|
      + |clause − 0.62|
      + |sensory − 1.56| / 2
```
Target (from v3/v4 reference): Δ-sum ≤ 0.50 on `salvatore-original-v1`,
Δ-sum ≤ 0.27 on held-out val.

**Secondary voice metrics** (from `docs/writer-imitation-benchmark.md`):
- 5-gram Jaccard max (memorization proxy): must stay ≤ 0.033 (v3 held-out reference)
- Paragraph-break coverage: must be present (v2 regression test)
- Pairwise pref-eval win rate vs real Salvatore prose: Sonnet sub-agent judge,
  blind A/B on 20 samples from `salvatore-original-v1`

### Leak measurement

Run the `halluc-leak-salvatore-v1` adapter (W&B `halluc-leak-salvatore-v1`) on
v5-stripped prose from the `salvatore-original-v1` set. Compare fire rate to:
- v4 baseline: ~9% per-call
- Blocklist-only (v3 production): ~9% (blocklist removed 2026-04-20 after
  priming hypothesis A/B showed +10.5pt worse — reverted to blocklist; see
  `docs/decisions.md` 2026-04-20)

Target for v5-stripped: <3% per-call fire rate on `salvatore-original-v1` prose.

### Pairwise preference

20 blind prose samples from `salvatore-original-v1` (5 per beat kind:
action / dialogue / interiority / description). Sonnet sub-agent receives
`(beat context, v4 prose, v5-stripped prose)` blind A/B. Reports:
- v5-stripped win rate vs v4
- Specific failure observations if v5-stripped loses

---

## 4. Decision gates

| Condition | Action |
|---|---|
| v5-stripped Δ-sum within **5%** of v4 on `salvatore-original-v1` **AND** leak adapter fire rate **<3%** | SHIP v5-stripped. Update `src/models/roles.ts` genre routing to `salvatore-v5-stripped`. Retire v4 blocklist. |
| Voice **drops >10%** (Δ-sum worsens by >0.05 absolute on `salvatore-original-v1`) | KILL. Keep v4 + blocklist. Record in `docs/decisions.md`. |
| Leak rate **>7%** (stripping did not move the needle) | KILL stripping hypothesis. Investigate brief-side name leakage. Consider also stripping the CHARACTERS: section of training user prompts. |
| Voice within 5–10% AND leak <3% | CONDITIONAL. Inspect specific regressions by beat kind. If only one kind (e.g., action) regresses, consider a less aggressive stripping pass (keep character names in action beats, strip place/artifact names only). |
| [PLACE] / [ARTIFACT] tokens appear in generated prose | ABORT IMMEDIATELY. Means placeholder tokens survived into model output. Switch to fluid generic substitutes (e.g., "the frozen region", "the enchanted blade") and re-run strip. |

---

## 5. Cost estimate

| Item | Estimate |
|---|---|
| Training (W&B ART metered) | ~$3–5 |
| Eval generation (18+60 briefs × W&B inference) | <$0.10 |
| Pairwise judge — 20 Sonnet sub-agent calls | ~$0 (sub-agents) |
| Leak adapter run on 18 briefs | ~$0 (W&B inference, tiny) |
| **Total** | **~$4–6** |

---

## 6. Open questions for user

**a. Brief stripping scope.** The current strip script touches PROSE only.
Character names still appear in the user prompt's CHARACTERS: section (from
`brief.characters`). If the model learns to copy names from the brief side
into prose, stripping prose alone won't cure leak. Options:
- Strip briefs too (replace character names in `brief.characters` with epithets
  matching the prose replacements).
- Accept brief-side names as necessary context anchors and measure whether leak
  persists via that path.
- Middle ground: strip place/artifact names from briefs, keep character names
  (they are necessary for adherence checking).

**b. Stripping aggressiveness.** Current rules use `[PLACE]` / `[ARTIFACT]`
placeholders. These are semantically null — the model learns "a token I cannot
name goes here." Alternative: use genre-appropriate generic substitutes
("the frozen dale", "the enchanted shard") that carry rhythm. This is more
work (requires manual curation per token) but avoids bracket-token artifacts.
Worth considering if [PLACE] tokens survive into generated output.

**c. ExampleLines axis.** The charter `docs/charters/salvatore-distinctness-conditioning-floor.md`
is testing whether rotating `exampleLines` at inference time improves character
distinctness without retraining. That experiment (conditioning-first) is
orthogonal to this ablation (training-data stripping). Should both run in
parallel? If conditioning-floor wins its gate before v5-stripped training
completes, it may be worth pausing v5-stripped to avoid confounding results
(both change different things about the same adapter family).

**d. Rename augmentation interaction.** The v4 formatter applies 3-variant
rename augmentation per chapter. The rename pool (`salvatore-rename-pool.json`)
maps Salvatore names to generic fantasy names (e.g., "Drizzt" → "Keldryn").
After prose stripping, variant 0 (original) has generic epithets; variants 1+2
have renamed characters. The rename pool's replacements are NOT the same as
the stripped epithets ("the dark elf" ≠ "Keldryn"). This creates a
within-chapter inconsistency for training: different representations of the
same entity. Decision needed: should rename augmentation be disabled for
v5-stripped (train on only 1 variant per chapter), or kept as additional
diversity?
