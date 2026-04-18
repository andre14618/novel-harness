---
status: proposed
kind: experiment-charter
experiment-family: salvatore-voice-lora
proposed-by: Codex
proposed-date: 2026-04-18
experiment-id: "#TBD allocate via createTuningExperiment()"
adversary-verdict: pending
---

# Experiment Charter — `salvatore-v5-corpus-expansion`

Option A from `docs/todo.md`: expand the Salvatore corpus before adding archetype tags or a larger base.

## 1. Question

Is Salvatore v4's remaining multi-character voice blur primarily a **corpus-breadth problem** rather than a **14B base-model-capacity / conditioning problem**?

## 2. Hypothesis

**If** we retrain the existing Qwen3-14B Salvatore writer LoRA on the full Icewind Dale bundle plus **4 priority breadth books** that introduce character voices absent or underrepresented in v4, **then** held-out multi-character distinctness **will improve by at least 15 percentage points** over v4 on a new pairwise character-separation eval, while voice retention on the existing Salvatore eval ladder **stays within a +0.15 Δ-sum band** of the better v3/v4 baseline, **because** the current corpus is still dominated by Drizzt/Bruenor/Wulfgar/Regis/Catti-brie and has near-zero direct signal for Jarlaxle's theatrical charm, Zaknafein's clipped menace, and other Salvatore archetypes the production writer now has to synthesize.

## 3. Falsification threshold

The mechanism is wrong if **either** of these happens:

1. v5 improves pairwise distinctness by **<5 points** versus v4 even after adding books centered on Jarlaxle / Zaknafein / adult Catti-brie. That means corpus breadth is not the bottleneck; conditioning or base-model capacity is.
2. v5 clears the distinctness target only by materially degrading Salvatore voice retention: **Δ-sum worsens by >0.15** versus the better of v3/v4 on the held-out Salvatore eval set. That means the added corpus is diluting the learned author signal rather than teaching controllable character separation.

## 4. Baseline ladder

| Slot | Model / config | Purpose |
|------|----------------|---------|
| Floor | `salvatore-1988-v3` | Earlier harness-shaped LoRA before full-trilogy + exampleLines improvements |
| Current prod | `salvatore-1988-v4` | Current fantasy default; must beat this to ship |
| Ceiling | Reasoning-model writer with full character profiles / exampleLines on the same distinctness eval | Stronger instruction-following anchor for the character-separation axis |

Notes:
- Voice-retention comparisons use the existing Salvatore eval sets already discussed in `docs/voice-lora-salvatore.md`: held-out val chapters plus `salvatore-original-v1`.
- Distinctness comparisons require a new held-out eval set; see §7.

## 5. Cheapest counterfactuals considered

| Lever | Estimated cost | Rejected because |
|-------|----------------|------------------|
| Diversify v4 `exampleLines` only (more examples or rotating examples at inference) | ~$0 | Cheap and still worth doing eventually, but it only reduces verbatim echo. It does not create any new supervised signal for Jarlaxle / Zaknafein / post-trilogy Catti-brie voices. |
| Option B first: archetype-tagged conditioning on the existing corpus | ~$10-15 + ~2 labeling days | Premature. If the current failure is missing raw voice coverage, tags would be learning on the same narrow cast distribution. Measure the cheap data-breadth lever first. |
| Option C first: 70B base jump on the same corpus | ~$50-150 training plus permanent inference tax | Too expensive before isolating whether the 14B base is actually the limiter. Option A is the minimum-cost test of the main uncertainty. |
| Add locally available late-style Salvatore only (`Pinquickle's Folly`) | near-zero corpus-prep cost | Explicitly rejected for v5. `docs/voice-lora-salvatore.md` says late Salvatore drifts; this would confound the measurement we care about. |

## 6. Distribution match

- **Train set stratification:** current Icewind Dale bundle (2,470 pairs) plus 4 priority books chosen for missing voice families, not chronology.
- **Eval set stratification:** existing Salvatore held-out val chapters and `salvatore-original-v1` for author-voice retention; new `salvatore-distinctness-v1` for pairwise character separation.
- **Production distribution:** fantasy seeds routed to `salvatore-1988-v4`, typically original casts with 1-3 dominant characters per beat, beat-context carrying profiles and exampleLines.

Mismatch to flag:

- The expanded corpus will still be fantasy-action Salvatore, not a general-purpose fantasy writer distribution.
- An Underdark-heavy expansion can overweight dark-elven menace unless at least one Catti-brie-forward / surface-human title is included.
- Current bundle tooling still consumes `config.yml` `source_files` under `source/*.txt`, while `docs/corpus-pipeline.md` describes root-level `canonical.txt`. That tooling mismatch is a process risk, not a hypothesis risk.

## 7. Success criteria

### Proposed training-data plan

Priority order is based on **character-voice breadth**, not chronology:

| Priority | Title | Why it is in-scope |
|---------|-------|--------------------|
| 1 | `Homeland` | Highest-yield Zaknafein corpus; adds clipped menace, House Do'Urden matriarchal venom, and younger Drizzt under a different social register. |
| 2 | `The Legacy` | Best early-adult Catti-brie / Wulfgar / Entreri spread outside the trilogy. Adds warmer human register and more emotionally stressed companion voices. |
| 3 | `Starless Night` | Best single-book Jarlaxle signal in the core Drizzt run; dense contrast between Jarlaxle's theatrical charm, Entreri's cold precision, and drow political voices. |
| 4 | `Servant of the Shard` | Jarlaxle / Entreri-heavy dialogue and political maneuvering; high-yield if `Starless Night` alone does not give enough Jarlaxle line density. |
| 5 | `Sojourn` (optional stretch) | Surface-world transition, ranger / mentor / outsider-human registers; use only after the top 4 if PDFs exist and time remains. |

Non-priority:

- `Pinquickle's Folly` stays out of v5 except as a late-style drift comparison, not training material.

### Expected beat yield

Ground truth from the reference bundle:

- Icewind Dale bundle: **2,470 beats from 3 books**
- Mean: **823 beats/book**
- Density: **~8.05 beats / 1K words** across ~307K words

Expected additions, using the trilogy mean plus 90K-110K-word paperback heuristics:

| Title | Heuristic words | Expected beats |
|-------|----------------:|---------------:|
| `Homeland` | ~100K | ~800-840 |
| `The Legacy` | ~100K | ~800-840 |
| `Starless Night` | ~105K | ~840-880 |
| `Servant of the Shard` | ~100K | ~800-840 |
| `Sojourn` (optional) | ~95K | ~760-800 |

Planning totals:

- **Core 4-book plan:** add ~3,240-3,400 beats; total corpus ~5,700-5,900 pairs with Icewind Dale included.
- **Stretch 5-book plan:** add ~4,000-4,200 beats; total corpus ~6,450-6,650 pairs.

### Success metrics

Two-axis gate:

| Axis | Metric | Ship threshold |
|------|--------|----------------|
| Voice retention | Re-run the existing Salvatore eval ladder on held-out val + `salvatore-original-v1`; compare v5 against v3/v4 by mean Δ-sum | v5 mean Δ-sum no worse than **+0.15** versus the better of v3/v4 |
| Multi-character distinctness | New `salvatore-distinctness-v1` eval: 24 lore-light held-out beats, 6 target voice cards, reasoning-model pairwise judge asked to match two anonymized outputs to the intended characters | v5 beats v4 by **≥15 points** overall and no anchor pair falls below **60%** judge accuracy |

`salvatore-distinctness-v1` spec:

- 24 held-out beats, 4 each for: Drizzt, Bruenor, Catti-brie, Entreri, Jarlaxle, Zaknafein
- Prompts are lore-light and reusable across characters: threat, reassurance, tactical planning, grief, triumph, banter
- Each beat is rendered twice with the same plot skeleton but different target character voice cards
- Judge sees both anonymized outputs plus the two intended voice cards and answers which output belongs to which character
- Score = exact assignment accuracy per pair, plus per-pair confusion matrix for the hard comparisons: Jarlaxle↔Zaknafein, Catti-brie↔Bruenor, Drizzt↔Entreri

### Outcome table

| Outcome | Condition | Action |
|---------|-----------|--------|
| SHIP V5 | Voice-retention band passes and distinctness improves by ≥15 pts over v4 | Promote v5, keep Option B in reserve |
| ITERATE TO V6 / OPTION B | Voice-retention band passes but distinctness gain is +5 to +14 pts, or one hard pair still confuses badly | Add archetype tags / prefix conditioning on the expanded corpus |
| KILL / PIVOT | Falsification threshold hit | Stop assuming more corpus fixes the problem; revisit conditioning or 70B base |

## 8. Budget

- **Spend cap:** **$10** training + **<$1** eval API spend
- **Time cap:** **~1.5 working days** wall-clock if source PDFs already exist locally
- **Training budget rationale:** `docs/fine-tuning-strategy.md` pegs Qwen3-14B W&B runs at ~$0.10-0.60 per ~700-pair / 3-epoch job. A 5.7K-5.9K-pair v5 run should still be low-single-digit dollars; `$10` leaves room for one corrective rerun.
- **Stage 3/4 corpus labor budget:** direct Sonnet API cost is effectively **$0** in the current Claude Code workflow, but expect **~130-150 beat/brief batches for 3 books** or **~420-470 batches for the 4-book plan**. Icewind Dale already demonstrated the scale: 71 beat-segmentation batches and 124 brief-extraction batches for 2,470 beats.
- **Stop if:** any source book is missing, any bundle fails hard invariants, or the distinctness eval is not ready before training approval.

## 9. Linked context

- Prior experiments: #196 (`salvatore-1988-v3`), #197 (`v4` one-epoch overfit probe), #198 (`v5` no-rename probe), #222 (`salvatore-1988-v4` shipped on the full 2,470-beat bundle)
- Related decisions: `docs/decisions.md` → "Voice-baked beat-writer shipped — Salvatore v4 is fantasy default"
- Related reports: `docs/voice-lora-salvatore.md`, `docs/fine-tuning-strategy.md`, `docs/writer-imitation-benchmark.md`
- Code / docs expected to change before any run approval: new book bundles under `novels/`, corpus ops in `scripts/corpus/` / `scripts/finetune/`, this charter
- `tuning_experiment` ID will be: **#TBD allocate via createTuningExperiment()**

## 10. Prerequisites & blockers

- **PDF / EPUB availability is the main blocker.** None of the priority Option A books are present as bundles in the repo today; only the Icewind Dale trilogy and `pinquickles-folly.txt` are currently visible.
- **Bundle/config authoring is still manual.** Current tooling has no `add-novel.ts`; each new bundle needs hand-written `config.yml`.
- **Pipeline maturity gap:** `docs/corpus-pipeline.md` describes `canonical.txt`, but the current scripts still drive Stage 2 from `config.yml` `source_files` under `source/*.txt` like the reference bundle.
- **Distinctness eval gap:** there is no canonical `salvatore-distinctness-v1` yet. The eval must be defined before training approval or the experiment becomes unjudgeable.
- **Dedup risk:** omnibus / anniversary editions can reprint chapters or append bonus excerpts. Merge step must dedupe by beat-id and normalized prose fingerprint.

## 11. Decision gate

Tripwires before any promotion:

1. **Ship v5** if:
   - all new bundles pass verification,
   - v5 stays within the +0.15 Δ-sum retention band,
   - `salvatore-distinctness-v1` improves by ≥15 points over v4,
   - no hard character pair scores below 60%.
2. **Escalate to Option B / v6** if:
   - retention passes,
   - distinctness improves but by <15 points,
   - or Jarlaxle / Zaknafein remains materially confused.
3. **Pivot away from corpus-only expansion** if:
   - improvement is <5 points,
   - or retention regresses by >0.15 Δ-sum,
   - or the newly added characters still collapse into the same voice family.

## 12. Adversary review

| Reviewer | Verdict | Date | Notes |
|----------|---------|------|-------|
| `/codex:adversarial-review` (GPT) — primary | pending | — | pending |
| `experiment-adversary` (Opus) — fallback only | — | — | pending only if requested |
