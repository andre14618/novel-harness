---
status: draft
updated: 2026-04-18
purpose: spec for hallucination-checker-v2 synthetic training data
mirrors: chapter-plan-checker-v2 methodology (exp #162/#164/#170/#178)
---

# Hallucination-checker-v2 — variant taxonomy and scenario spec

## Context

v1 landed **86.5% precision / 78.0% recall / 82.1% F1 / 91.3% accuracy** on the natural 160-beat val (exp #223). `chapter-plan-checker-v2` reached 96% by training on 65 hand-authored scenarios × 8 variants (520 pairs, 50/50 balance, Cerebras-generated prose, Sonnet-labeled). v1 was trained on natural-distribution beats where rubric edge cases only appeared by accident. v2 mirrors the chapter-plan methodology end-to-end.

**Authoritative rubric:** `labeling-rubric.md`. **Labeling SOP:** `docs/synthetic-labeling-sop.md`. This doc adds generation recipes only.

**Writer-model update (2026-04-18):** default writer for synthetic prose generation is now **DeepSeek V3.2 (`deepseek-v4-flash`)**, not Cerebras Qwen 235B. Measured A/B on v2 generation: DS=99.4% Sonnet agreement vs Cerebras=96.4%. Generator supports both via `HALLUC_WRITER_PROVIDER` env var (`deepseek` or `cerebras`). Cerebras remains a valid choice when speed outweighs adherence quality.

## What chapter-plan did that we're copying

| Step | Chapter-plan | Hallucination v2 |
|---|---|---|
| Scenario authoring | 65 `ChapterScenario` structs hand-authored in a generator script | 50 `HallucScenario` structs — brief + world_bible + speakers |
| Variant count | 8 (4 PASS + 4 FAIL) | 10 (5 PASS + 5 FAIL) |
| Total pairs | 520 (65 × 8) | **500 (50 × 10)** |
| Class balance | 50/50 (260 / 260) | **50/50 (250 / 250)** |
| Prose generation | Cerebras Qwen 235B, temp 0.8, JSON-wrapped | Same — Cerebras 235B |
| Label derivation | Pre-known from `VariantSpec.deviations` | Pre-known from `VariantSpec.issues` |
| Validation gate 1 | Injection quality (pattern present in prose) | Same — variant-specific keyword/regex check |
| Validation gate 2 | Sonnet teacher labeling via parallel Claude Code subagents | Same — 20 batches of 25 pairs |
| Acceptance threshold | ≥90% Sonnet agreement overall; per-variant thresholds | Same shape; see §"Acceptance gates" |
| Replay | `buildContext()` used by live checker produces training input | Same — reuse the v1 system prompt formatter |

v1's natural 640/160 train/val split is **retained only as a held-out production sanity check.** Synth training is pure synthetic, matching chapter-plan. If synth-trained v2 fails on natural val, that's a signal to merge — not the default.

## Data plan

| Set | Pairs | Role |
|---|---|---|
| `halluc-checker-v2-train.jsonl` | ~400 | 40 scenarios × 10 variants (pure synth, 50/50) |
| `halluc-checker-v2-val-synth.jsonl` | 100 | 10 scenarios × 10 variants (disjoint scenarios, 50/50) |
| `hallucination-val-v1` (natural, existing) | 160 | held-out generalization eval (unchanged) |

Scenario split: **40 train / 10 val**, stratified by genre + beat-kind + WB-density so both splits share distribution.

## Variant taxonomy (10 recipes — 5 PASS + 5 FAIL)

Each variant is a `VariantSpec` with: `type`, `pass: boolean`, `issues: [{entity, excerpt}]` (pre-known expected output), `instruction(scenario)` (prompt delta for Cerebras), optional `injectionCheck(prose)` (Phase 1A gate).

### PASS variants (5)

| ID | Instruction delta | Injection check |
|---|---|---|
| `PASS_CLEAN` | Write ~200w beat exactly per brief. Every proper noun must already appear in speakers, brief, or world_bible. | No capitalized non-grounded proper noun in prose |
| `PASS_LAST_NAME_ALIAS` | Same + "at least once refer to `{First Last speaker}` by surname only" | Grounded surname alone ≥1 occurrence |
| `PASS_TITLE_GROUNDED` | Same + "use `Title {grounded-surname}` at least once (e.g. Lord Drayce, Healer Dunmore)" | `/(Title) (grounded-surname)/` present |
| `PASS_ANAPHORIC_GENERIC` | Same + "refer to grounded entities via generic definite phrases at least twice ('the captain', 'the road', 'the villagers'), lowercase race terms OK" | ≥2 `/the (lowercase-noun)/` matches, no new proper nouns |
| `PASS_REAL_WORLD_REF` | Same + "include one real-world reference (day/month/real country/real object) used descriptively" | Real-world token from allowlist present |

### FAIL variants (5)

| ID | Instruction delta | Pre-known issue | Injection check |
|---|---|---|---|
| `FAIL_NEW_CHARACTER` | "Insert 1–2 sentences mentioning a NEW proper-noun character named `{picked_name}` — NOT in speakers or brief. Can be narration or dialogue; picker determines which." | `{entity: picked_name}` | `picked_name` substring present |
| `FAIL_NEW_PLACE` | "Insert 1–2 sentences referencing a new named location `{picked_place}` not in world_bible.locations" | `{entity: picked_place}` | `picked_place` substring present |
| `FAIL_NEW_SYSTEM_OR_FACTION` | "Insert either (a) named magic/tech system `{picked_system}` not in world_bible.systems, OR (b) named plural faction `{picked_faction}` not in world_bible.cultures. Coin-flip chooses." | `{entity: picked_system_or_faction}` | Picked token present |
| `FAIL_CORPUS_LEAK` | "Insert 1 explicit Salvatore/FR reference: `{picked_leak}` (rotated from labeling-rubric.md §A leak list)" | `{entity: picked_leak}` | Leak token case-insensitive present |
| `FAIL_FIRST_NEW_LAST` | Requires `First Last` speaker. "Refer to `{speaker_first_name}` once with surname `{picked_new_surname}`" | `{entity: "{first} {new_last}"}` | Combined `First NewLast` present |

**Name/place/leak pickers** are deterministic from `scenario_id` (hash → index into fixed pools), so regeneration produces identical pairs. Pools live in `scripts/hallucination/injection-pools.json`:
- `characterNames[]` — ~60 realistic fantasy names (not in leak list)
- `placeNames[]` — ~40 realistic fantasy places
- `systemNames[]` / `factionNames[]` — ~30 each
- `leakTokens[]` — from `labeling-rubric.md` §A

### Coverage vs v1 error patterns

| v1 error | Addressed by |
|---|---|
| FN: Cassius, Helix, Demos, Gamma, Vas'thar (missed new chars) | `FAIL_NEW_CHARACTER` × 50 scenarios = 50 training examples |
| FN: Great Chasm, Northland (missed places) | `FAIL_NEW_PLACE` × 50 |
| FN: deep-folk (missed lowercase race) | Negative space for `PASS_ANAPHORIC_GENERIC` teaches lowercase races are fine; if we see natural lowercase-race FAILs later, add a FAIL variant |
| FP: Archmage, Sword (generic/title false alarm) | `PASS_ANAPHORIC_GENERIC` + `PASS_TITLE_GROUNDED` explicitly teach hold-fire |
| FP: Mottled (epithet on grounded char) | Deliberately skipped — rare in generated prose |

## Scenario authoring

50 `HallucScenario` structs in `scripts/hallucination/generate-halluc-data.ts`. Same pattern as `archives/novel-harness/scripts/generate-chapter-plan-data.ts`.

```typescript
interface HallucScenario {
  id: string
  genre: "fantasy" | "dark-fantasy" | "portal-fantasy" | "gamelit" | "sci-fi" | "contemporary" | "romance"
  brief: {
    kind: "action" | "dialogue" | "interiority" | "description"
    pov: string
    setting: string
    characters: string[]
    summary: string
  }
  worldBible: {
    locations: Array<{ name: string }>
    cultures: Array<{ name: string }>
    systems: Array<{ name: string }>
  }
  speakers: Record<string, string>  // name → speech pattern description
}
```

**Authoring constraint (non-negotiable):** every scenario MUST have at least one `First Last` speaker. `PASS_LAST_NAME_ALIAS` and `FAIL_FIRST_NEW_LAST` require it; uniform constraint keeps the 10-variant grid clean.

**Distribution targets (50 scenarios):**
- Genre: 30 fantasy/dark/portal/gamelit (60%) + 8 sci-fi + 6 contemporary/romance + 6 dark-fantasy (robustness)
- Beat kinds: 15 action + 15 dialogue + 10 interiority + 10 description
- World-bible density: 15 thin (≤3 locations, ≤2 cultures, ≤1 system) + 25 medium + 10 dense
- Character count: 15 solo + 25 two-character + 10 three-character

## Generation pipeline

Four stages, each with its own `tuning_experiment` row linked via `experiment_lineage` to a parent "v2 data generation" experiment. Stage 1 is the parent.

### Stage 1 — scenario authoring
Hand-author `SCENARIOS` in `generate-halluc-data.ts` (50 entries). Commit. This is the single checkpoint that needs human quality control — all downstream stages are deterministic.

### Stage 2 — prose generation
For every (scenario × variant), call Cerebras Qwen 235B at temp 0.8 with the `VariantSpec.instruction(scenario)`. Output JSON-wrapped prose. Concurrency 10 (per parallel-batch memory). Runtime: ~30 min for 500 pairs at Cerebras rates.

Output: `finetune-data/halluc-checker-v2-pairs-raw.jsonl` — each line is a full training pair with `_meta.variant` + `_meta.scenario` + `_meta.injection_token` (the picked name/place/leak, for Stage 3 checking).

### Stage 3 — injection validation (Phase 1A equivalent)
Regex/substring gate: does the prose actually contain the injection? Per-variant thresholds:

| Variant | Threshold | Fallback |
|---|---|---|
| PASS_CLEAN | ≥95% (no proper-noun leaks) | Regenerate failing pairs |
| PASS_LAST_NAME_ALIAS | ≥90% (surname alone appears) | Regenerate |
| PASS_TITLE_GROUNDED | ≥90% | Regenerate |
| PASS_ANAPHORIC_GENERIC | ≥85% (2+ "the X" matches) | Regenerate |
| PASS_REAL_WORLD_REF | ≥85% | Regenerate |
| FAIL_NEW_CHARACTER | ≥95% | Regenerate |
| FAIL_NEW_PLACE | ≥95% | Regenerate |
| FAIL_NEW_SYSTEM_OR_FACTION | ≥95% | Regenerate |
| FAIL_CORPUS_LEAK | ≥95% | Regenerate |
| FAIL_FIRST_NEW_LAST | ≥95% | Regenerate |

Output: `finetune-data/halluc-checker-v2-pairs-injected.jsonl` (only pairs passing Stage 3).

### Stage 4 — Sonnet teacher labeling (parallel Claude Code subagents)
Split into 20 batches × 25 pairs. Spawn 20 parallel Claude Code subagents per `docs/synthetic-labeling-sop.md` (10-at-a-time wave to respect the parallel-batch cap). Each subagent reads its batch from `/tmp/halluc-label/batch_NN.json`, applies the rubric in `labeling-rubric.md`, writes `{id, scenario, variant, found: {pass, issues[]}, expected: {pass, issues[]}, match: bool, note}` lines to `/tmp/halluc-label/results_NN.jsonl`.

Aggregate with `aggregate-halluc-labels.ts` (mirror `aggregate-chapter-plan-labels.ts`).

### Acceptance gates (go/no-go before training)

| Gate | Condition | Action if fail |
|---|---|---|
| Overall Sonnet agreement | ≥90% | Re-audit rubric with mismatched pairs, iterate (chapter-plan did this — exp #169 at 88% failed, exp #170 at 96% passed) |
| `PASS_CLEAN` | ≥95% (rubber-stamp test) | Fix generator — Cerebras may be leaking names |
| `FAIL_CORPUS_LEAK` | ≥95% (unambiguous) | Fix injection pool |
| `FAIL_NEW_*` (char/place/system) | ≥90% each | Regenerate failing variant |
| `PASS_ANAPHORIC_GENERIC` | ≥85% (hardest PASS — Sonnet has to hold fire on lowercase/generic) | Audit FPs; refine instruction if Cerebras keeps adding proper nouns |
| `FAIL_FIRST_NEW_LAST` | ≥85% (edge rule) | Audit — make sure it's the explicit name-drift pattern |
| Class balance post-filter | PASS:FAIL within 45:55–55:45 | Oversample weak class |

### Stage 5 — SFT formatting + training
`format-v2-sft.ts` writes `finetune-data/halluc-checker-v2-{train,val-synth}.jsonl` with 80/20 scenario-stratified split (40 train / 10 val scenarios).

Train on W&B via `scripts/finetune/train-lora.py`:
- Base: `OpenPipe/Qwen3-14B-Instruct`
- r=16, alpha=32
- Epochs: 3 (chapter-plan used 3; adherence-v4 used 3)
- LR: 1e-4
- Estimated cost: ~$1

### Stage 6 — eval
Extend `scripts/hallucination/full-eval.ts` to run on both val sets. Adapter: `hallucination-checker-v2:v1`. Writes to `eval_results` under a new `checker-eval` experiment.

## Success criteria

| Val set | Precision(FAIL) | Recall(FAIL) | F1 | Accuracy |
|---|---|---|---|---|
| `hallucination-val-synth-v1` (balanced, apples-to-apples vs chapter-plan) | **≥95%** | ≥93% | ≥94% | ≥95% |
| `hallucination-val-v1` (natural, generalization check) | **≥92%** | ≥85% | ≥88% | ≥93% |

If synth clears but natural doesn't: the synthetic distribution is missing a pattern real production prose produces. Merge 640 natural train into v3 and retrain. Do NOT ship v2 if natural precision is under 90% (fire rate would degrade drafting).

If both clear: ship, wire into drafting retry per todo #1, harvest production FPs for v3.

## Cost estimate

| Stage | Calls | Cost |
|---|---|---|
| 2. Prose generation (Cerebras 235B) | 500 calls × ~1200 out tokens | ~$1.50 |
| 3. Injection validation | local regex | $0 |
| 4. Sonnet labeling (Claude Code subagents) | 500 labels via 20 subagents | $0 marginal (Claude Code subscription) |
| 5. SFT training (W&B) | 1 training run, r=16 | ~$1 |
| 6. Eval (both val sets) | 260 W&B adapter calls | <$0.05 |
| **Total** | | **~$2.55** |

## Implementation files

| Path | Role | Mirror of |
|---|---|---|
| `scripts/hallucination/generate-halluc-data.ts` | Scenarios + variant specs + Cerebras generation | `archives/.../scripts/generate-chapter-plan-data.ts` |
| `scripts/hallucination/injection-pools.json` | Name/place/system/faction/leak pools | new |
| `scripts/hallucination/validate-injections.ts` | Stage 3 keyword check | new |
| `scripts/hallucination/aggregate-halluc-labels.ts` | Stage 4 subagent results merge | `scripts/finetune/aggregate-chapter-plan-labels.ts` |
| `scripts/hallucination/format-v2-sft.ts` | Stage 5 train/val split | extends existing `format-sft.ts` |
| `scripts/hallucination/full-eval.ts` | Stage 6 dual-val eval | exists; extend to run both val sets |

## Locked decisions (2026-04-18)

- **Val split:** option (a) — 10 scenarios held out from Stage 1 authoring → 100 synth val (balanced), 40 × 10 = 400 train. Gives us the apples-to-apples number vs chapter-plan's 96%.
- **Dialogue-only edge rule:** folded into `FAIL_NEW_CHARACTER` via deterministic 50/50 split (even scenario hashes → dialogue-only, odd → narration). Stage 4 labeling tracks sub-case agreement in the `note` field. If Sonnet agreement on dialogue-only sub-cases is <80%, promote to its own variant in v3.
- **Mandatory `First Last` speaker per scenario:** enforced at authoring time. Solo-POV scenarios must give the POV character a full name. Non-POV speakers can stay mononym if they don't gate any variant. Stage 1 rejects any scenario without at least one `First Last` speaker.
- **Cerebras PASS-side leak check:** Stage 3 adds a negative proper-noun check for all PASS variants. Extract all capitalized tokens (incl. multi-word), subtract grounded set (speakers + brief.characters + brief.setting + WB.locations + WB.cultures + WB.systems + real-world allowlist + sentence-initial common-noun allowlist), flag any residual. If residual token rate >5% across PASS variants, add a Cerebras post-processing scrub pass.

## Production routing (future — not v2 scope)

Consider adding `severity` to the output schema in v3:

```json
{"pass": false, "issues": [{"entity": "Crystal Shard", "excerpt": "...", "severity": "leak"}]}
```

- `severity: "leak"` — corpus leakage (Salvatore/FR). Always ship-blocker → mandatory retry.
- `severity: "drift"` — name drift (first+new-last). Always ship-blocker.
- `severity: "ungrounded"` — new character/place/system/faction. Configurable retry threshold.

This gives drafting-retry flexibility without a second adapter. Out of scope for v2 — ship the binary `{pass, issues}` first, add severity in v3 once we have production signal on which categories to harden.
