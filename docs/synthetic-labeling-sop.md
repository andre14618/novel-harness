---
status: active
updated: 2026-04-11
---

# Synthetic Labeling SOP — Parallel Claude Subagent Data Collection

Operational guide for collecting SFT training data using parallel Claude Code subagents. Covers two tasks: **continuity-checker** (Sonnet as bulk teacher) and **chapter-plan-checker** (gpt-oss-120b bulk + Sonnet escalation for FAIL_MISSING_BEAT).

## Writer model selection (updated 2026-04-18)

For synthetic prose generation in training-data pipelines, **DeepSeek V4 Flash (`deepseek-v4-flash`) is the default writer** (V3.2 → V4 Flash swap landed 2026-04-29; V3.2's measured advantage carries forward as same-family successor), not Cerebras Qwen 235B. Measured 2026-04-18 on V3.2 (hallucination-checker-v2 A/B): DS hit 99.4% Sonnet agreement + 2% injection-fail rate vs Cerebras's 96.4% + 4.6%. DS is ~3× cleaner on instruction-constrained prose.

Keep Cerebras only when raw throughput trumps adherence (e.g., bulk fire-and-forget exploration). For any scripted tool that generates training data, scenarios, or adherence-sensitive probes, use DeepSeek.

## Methodology

Established in exp #147 (1,559 adherence pairs, 78 parallel subagents, ~30 min wall time, $0 marginal cost under Claude Code subscription):

1. Export pairs as individual JSON batch files locally
2. Spawn N parallel Claude Code subagents — one per batch file
3. Each subagent reads its batch, evaluates each pair, writes structured JSONL results
4. Aggregate JSONL files with a local Bun script
5. Rsync aggregated file to LXC → record in DB via `concludeExperiment()`

**Batch sizing:** 15–20 pairs per subagent for short-context tasks (adherence, chapter-plan). 8–12 pairs for continuity (longer drafts + facts + states context).

---

## Task 1: Continuity-Checker SFT Data

### Context

- **Current state:** 120 pairs in `lora-data/continuity-pairs.jsonl` (20 scenarios × 6 variants: VAR_NONE, VAR_BLOCKER, VAR_WARNING, VAR_NIT, VAR_TRAP, VAR_MULTI)
- **The problem:** 235B misses 90% of WARNINGs, 65% of NITs (exp #117/#118). It cannot be the teacher.
- **The teacher:** Sonnet 4.6. Cost ~$15/1,000 pairs via API; $0 via Claude Code subagents.
- **Target:** 300 pairs for V1 adapter (Phase 1). 1,000+ for a robust V2 (Phase 2, requires expanding the generator).

### Phase 1A: Validate injection quality (before any labeling)

Run a spot-check on the 120 generated pairs before using Sonnet as teacher. The risk is that Cerebras 235B papered over injections when generating drafts (same failure pattern as FAIL_MISSING_BEAT in chapter-plan — see `lora-data/inspect-fail_missing_beat.md`).

**What to check per variant type:**

| Variant | Check |
|---|---|
| VAR_BLOCKER | Dead character's name OR wrong-location phrase appears in the draft |
| VAR_WARNING | Timeline-mismatch phrase (e.g., "morning sun" after "evening" setup) is in the draft |
| VAR_NIT | Both the original description word AND the changed word appear within 200 chars of each other |
| VAR_TRAP | The metaphor phrase is present and is clearly figurative (not a literal location change) |
| VAR_NONE | No injected issue text appears anywhere |
| VAR_MULTI | Both the blocker and nit injection keywords are present |

**Acceptance threshold:** ≥85% of pairs per variant type have the injection present and unambiguous. If any variant type falls below 70%, regenerate those pairs before proceeding to labeling.

To do this, write a quick scan script:
```bash
ssh novel-harness-lxc "cd ~/apps/novel-harness && ~/.bun/bin/bun -e \"
const lines = Bun.file('lora-data/continuity-pairs.jsonl').text().then(t => {
  const pairs = t.trim().split('\n').map(l => JSON.parse(l))
  // Each pair has _meta.variant and the user message content containing the draft
  const byVariant = {}
  for (const p of pairs) {
    const v = p._meta?.variant
    byVariant[v] = (byVariant[v] || 0) + 1
  }
  console.log(JSON.stringify(byVariant, null, 2))
})
\""
```

If the JSONL doesn't have `_meta` fields, check the generator — each pair should be written with `_meta: { scenario: s.id, variant: variantType }`.

### Phase 1B: Pilot eval (30 pairs, 3 subagents)

Before a full labeling run, validate that Sonnet can actually detect what 235B misses.

**Setup:**

Export 30 pairs (5 per variant type) to individual batch files:

```bash
# On LXC
cd ~/apps/novel-harness
mkdir -p /tmp/continuity-pilot

~/.bun/bin/bun -e "
const lines = await Bun.file('lora-data/continuity-pairs.jsonl').text()
const pairs = lines.trim().split('\n').map(l => JSON.parse(l))

// Take 5 of each variant type
const byVariant = {}
const selected = []
for (const p of pairs) {
  const v = p._meta?.variant ?? 'unknown'
  byVariant[v] = (byVariant[v] || 0)
  if (byVariant[v] < 5) { selected.push(p); byVariant[v]++ }
}

// Write 3 batches of 10
for (let i = 0; i < 3; i++) {
  const batch = selected.slice(i*10, (i+1)*10)
  await Bun.write('/tmp/continuity-pilot/batch_' + i.toString().padStart(2,'0') + '.json', JSON.stringify(batch, null, 2))
}
console.log('Wrote', selected.length, 'pairs across 3 batches')
"
```

**Subagent prompt template (use this verbatim for each batch):**

```
You are evaluating synthetic continuity-checker training pairs for label quality.

Each pair in the batch has:
- `messages[1].content` — the user message (CHAPTER DRAFT + ESTABLISHED FACTS + CHARACTER STATES)
- `messages[0].content` — the system prompt (the continuity checker system prompt)
- `_meta.variant` — the variant type (VAR_NONE, VAR_BLOCKER, VAR_WARNING, VAR_NIT, VAR_TRAP, VAR_MULTI)
- `_meta.scenario` — the scenario ID

Your job: for each pair, run the continuity evaluation yourself (read the draft against the facts/states), then record:
1. What severities you found (blocker / warning / nit — list all that apply, empty list if none)
2. Whether your finding matches the expected label for that variant:
   - VAR_NONE → expect [] (no issues)
   - VAR_BLOCKER → expect ["blocker"]
   - VAR_WARNING → expect ["warning"]
   - VAR_NIT → expect ["nit"]
   - VAR_TRAP → expect [] (metaphor only, do NOT flag)
   - VAR_MULTI → expect ["blocker", "nit"]
3. If mismatch: a one-sentence note on why (e.g., "injection not present in draft", "figurative language mistaken for literal")

Read the batch from: /tmp/continuity-pilot/batch_NN.json
(Replace NN with your assigned batch number: 00, 01, or 02)

For each pair, produce one line of JSON:
{"scenario": "...", "variant": "...", "found": ["blocker"|"warning"|"nit"|...], "expected": [...], "match": true/false, "note": "..." or null}

Write all results to: /tmp/continuity-pilot/results_NN.jsonl
(Same NN as your batch number)

After writing, print a summary: total pairs, match count, mismatch count, mismatches by variant type.
```

**Pilot acceptance thresholds:**

| Variant | Minimum Sonnet accuracy |
|---|---|
| VAR_BLOCKER | ≥95% (these are unambiguous; below 95% means injection quality problem) |
| VAR_WARNING | ≥80% (235B catches <10%; anything above 70% is a win) |
| VAR_NIT | ≥80% (235B catches <35%) |
| VAR_TRAP | ≥90% precision (must NOT flag metaphors) |
| VAR_NONE | ≥95% (no false positives on clean drafts) |
| VAR_MULTI | ≥85% (both blocker and nit must be found) |

If any variant fails threshold: check whether the injection is actually present (Phase 1A issue) vs Sonnet genuinely missing it. If injection is missing, fix the generator. If Sonnet is genuinely missing it, consider whether the injection is too subtle.

### Phase 1C: Full labeling run (120 pairs → 120 training pairs)

Once pilot passes, label all 120 existing pairs. 12 batches of 10 pairs each = 12 subagents in parallel.

```bash
# On LXC — split into batches
mkdir -p /tmp/continuity-label
~/.bun/bin/bun -e "
const lines = await Bun.file('lora-data/continuity-pairs.jsonl').text()
const pairs = lines.trim().split('\n').map(l => JSON.parse(l))
const BATCH = 10
for (let i = 0; i < pairs.length; i += BATCH) {
  const batch = pairs.slice(i, i + BATCH)
  const n = String(Math.floor(i/BATCH)).padStart(2, '0')
  await Bun.write('/tmp/continuity-label/batch_' + n + '.json', JSON.stringify(batch, null, 2))
}
console.log(Math.ceil(pairs.length / BATCH), 'batches written')
"
```

**Subagent prompt (full labeling run):**

```
You are labeling continuity-checker training pairs for SFT fine-tuning.

Read the batch from: /tmp/continuity-label/batch_NN.json

For each pair:
1. The messages array has system (continuity checker prompt) + user (CHAPTER DRAFT + FACTS + STATES).
2. Evaluate the draft against the facts/states exactly as the production continuity-checker would.
3. Record what severity issues you found (blocker / warning / nit, empty list if none).
4. Record whether your label matches the expected label from _meta.variant:
   VAR_NONE → [] | VAR_BLOCKER → ["blocker"] | VAR_WARNING → ["warning"]
   VAR_NIT → ["nit"] | VAR_TRAP → [] | VAR_MULTI → ["blocker","nit"]

Write one JSON line per pair to /tmp/continuity-label/results_NN.jsonl:
{"id": "<scenario>_<variant>", "scenario": "...", "variant": "...", "found_severities": [...], "expected_severities": [...], "match": true/false, "sonnet_issues": [{"severity":"...","description":"...","conflictsWith":"..."}], "note": "..." or null}

Replace NN with your batch number. After writing, print: total / match count / mismatch count.
```

### Phase 2: Scale to 300 pairs

Add 10 more scenarios to `scripts/generate-continuity-data.ts` (brings total to 30 scenarios × 6 variants = 180 pairs). Then add 2 additional WARNING variants per scenario (VAR_WARNING_2, e.g., a travel-distance mismatch distinct from the timeline mismatch) to reach ~300 pairs.

New scenarios should cover:
- At least 2 LitRPG/progression-fantasy scenarios (character levels/skills as the "established facts")
- At least 2 multi-chapter carryover scenarios (facts from chapters 6–10, not just 1–3)
- At least 1 scenario with a knowledge-violation blocker that's NOT a dead character

### Aggregation

```bash
# On LXC, after all subagents complete
~/.bun/bin/bun -e "
import { join } from 'path'
import { readdirSync } from 'fs'

const dir = '/tmp/continuity-label'
const files = readdirSync(dir).filter(f => f.startsWith('results_'))
let total = 0, matches = 0
const mismatches = []

for (const f of files) {
  const lines = (await Bun.file(join(dir, f)).text()).trim().split('\n').filter(Boolean)
  for (const l of lines) {
    const r = JSON.parse(l)
    total++
    if (r.match) matches++
    else mismatches.push(r)
  }
}

console.log('Total:', total, '| Match:', matches, '| Mismatch:', total - matches)
console.log('Accuracy:', (matches/total*100).toFixed(1) + '%')
console.log('Mismatches:', JSON.stringify(mismatches, null, 2))
"
```

Accept the labeled set for training when overall accuracy ≥82% (leave mismatch pairs in but flag them for human review before V2 training).

---

## Task 2: Chapter-Plan-Checker SFT Data

### Context

- **Current state:** 80 pairs in `lora-data/chapter-plan-checker-pairs.jsonl` (10 scenarios × 8 variants)
- **The problem:** Base 14B at 58% overall accuracy; 100% PASS bias (rubber-stamps everything). gpt-oss-120b is the validated teacher at 90% on these 80 pairs. FAIL_MISSING_BEAT is the hard case — gpt-oss catches only 50%.
- **The plan:** Scale to 200 pairs via gpt-oss bulk labeling, then Sonnet escalation on FAIL_MISSING_BEAT cases where gpt-oss says PASS.
- **Known data quality issue:** FAIL_MISSING_BEAT pairs have 64% keyword leak (inspect log archived at `personal_projects/archives/novel-harness/lora-data/inspect-fail_missing_beat.md`). Prose often starts with characters already mid-beat-2, referencing beat 1 events obliquely. These are ambiguous training examples — Sonnet escalation decides which to keep.

### Step 1: Scale to 200 pairs (add 15 scenarios)

> **Note:** `scripts/generate-chapter-plan-data.ts` was archived to `personal_projects/archives/novel-harness/scripts/` during the 2026-04-13 repo cleanup. Restore it before running this step.

Add 15 new `ChapterScenario` objects to `scripts/generate-chapter-plan-data.ts`. Each scenario must specify a complete `ChapterOutline` with exactly 4 `scenes`. Prioritize:
- LitRPG scenarios (dungeon entry, skill-check moment, loot division, guild registration)
- Multi-character scenes (3+ characters) — currently all scenarios have ≤3 characters
- Scenarios where beat 1 involves a *discovery* or *arrival* (these generate cleaner FAIL_MISSING_BEAT cases than scenes where beat 1 is "characters discuss X")

After adding scenarios, run the generator:
```bash
ssh novel-harness-lxc "cd ~/apps/novel-harness && nohup ~/.bun/bin/bun scripts/generate-chapter-plan-data.ts > /tmp/chapter-plan-gen.log 2>&1 &"
```

This regenerates the full JSONL from scratch (it deletes and rewrites the output file). Runtime ~20 min for 25 scenarios × 8 variants = 200 pairs on Cerebras.

### Step 2: gpt-oss-120b bulk labeling

> **Note:** `scripts/score-chapter-plan-baseline.ts` and `scripts/score-chapter-plan-teachers.ts` were archived to `personal_projects/archives/novel-harness/scripts/`. Restore before running.

gpt-oss-120b is a direct API call, not a Claude Code subagent task. Run it via `scripts/score-chapter-plan-baseline.ts` or the teachers script with `EXPERIMENT_ID` set. This produces a label file with `{pair_id, gpt_oss_verdict: {pass, deviations, beats_covered}, ...}`.

```bash
ssh novel-harness-lxc "cd ~/apps/novel-harness && EXPERIMENT_ID=<new_exp_id> nohup ~/.bun/bin/bun scripts/score-chapter-plan-teachers.ts > /tmp/chapter-plan-gptoss.log 2>&1 &"
```

Expected output: ~90% agreement with deterministic labels on PASS variants, ~50% recall on FAIL_MISSING_BEAT.

### Step 3: Sonnet escalation for FAIL_MISSING_BEAT

After gpt-oss labeling, extract the FAIL_MISSING_BEAT pairs where gpt-oss returned PASS:

```bash
# On LXC
~/.bun/bin/bun -e "
// Load pairs + gpt-oss labels
// Filter: variant == FAIL_MISSING_BEAT AND gpt_oss.pass == true
// Write to /tmp/missing-beat-escalation/batch_NN.json (5 pairs per batch)
"
```

There will be roughly 15–25 such pairs from 200 total (FAIL_MISSING_BEAT is 1/8 of variants = 25 pairs, gpt-oss misses ~50% = ~12 escalation candidates).

**Subagent prompt (FAIL_MISSING_BEAT escalation):**

```
You are a quality judge for chapter-plan-checker training data. Specifically: you are reviewing pairs where gpt-oss-120b said PASS but the labeled variant is FAIL_MISSING_BEAT.

Background: FAIL_MISSING_BEAT pairs were generated by asking a writer model to skip beat 1 of the plan entirely. The writer often papers over this by starting mid-scene with characters already past beat 1, sometimes referencing beat 1 events obliquely ("he had already given her the coin", "the argument from earlier"). This makes the FAIL ambiguous: is the beat truly absent, or was it referenced enough that a reader would infer it happened?

Your job: for each pair, read the CHAPTER PLAN (to identify beat 1's exact action) and the CHAPTER PROSE. Then judge:

ABSENT — beat 1 is completely missing. The prose does NOT portray beat 1's core action, even in summary or flashback. The reader has no information about beat 1. → label: FAIL (keep in training data)

OBLIQUE_REFERENCE — the prose doesn't show beat 1 happening but references its result or assumes it happened. Example: beat 1 is "Hal arrives soaked and demands the draught" — prose opens with "Hal had already made his demand and now waited for Vira's answer." The reader can infer beat 1 occurred. → label: AMBIGUOUS (flag for removal from training data)

IN_MEDIAS_RES_CLEAN — the prose opens in the middle of beat 1's action (the beat IS happening when prose starts). → label: PASS (gpt-oss is probably right to call this PASS)

Read your batch from: /tmp/missing-beat-escalation/batch_NN.json

For each pair write one JSON line to /tmp/missing-beat-escalation/results_NN.jsonl:
{"pair_id": "...", "scenario": "...", "beat_1_action": "...", "opening_50_words": "...", "verdict": "ABSENT"|"OBLIQUE_REFERENCE"|"IN_MEDIAS_RES_CLEAN", "reasoning": "..."}

Replace NN with your batch number. Print summary after writing.
```

**Merge strategy:**
- `ABSENT` → use FAIL label in training data (override gpt-oss PASS)
- `OBLIQUE_REFERENCE` → remove from training data (ambiguous)
- `IN_MEDIAS_RES_CLEAN` → accept gpt-oss PASS label (correct call)

### Step 4: Final dataset check

Before training, verify class balance:

| Variant | Count | Target % |
|---|---|---|
| PASS_CLEAN | ~25 | ~12.5% |
| PASS_PARAPHRASE | ~25 | ~12.5% |
| PASS_REORDER | ~25 | ~12.5% |
| PASS_ATMOSPHERIC | ~25 | ~12.5% |
| FAIL_MISSING_BEAT | ~20 (after removals) | ~10% |
| FAIL_MISSING_CHAR | ~25 | ~12.5% |
| FAIL_REVERSED_ARC | ~25 | ~12.5% |
| FAIL_WRONG_SETTING | ~25 | ~12.5% |

PASS : FAIL ratio should be 50:50 (±5%). If FAIL_MISSING_BEAT removals throw this off, oversample the remaining FAIL pairs or generate 5 more clean FAIL_MISSING_BEAT scenarios.

---

## Shared Patterns

### Experiment creation (run before any data collection step)

```typescript
const expId = await createTuningExperiment(
  "data-generation",
  "Continuity SFT — Sonnet teacher labeling, 120 pairs Phase 1",
  { pairs: 120, teacher: "claude-sonnet-4-6", batchSize: 10, subagents: 12 },
  { target: "continuity", dimension: "calibration" }
)
```

Always set `EXPERIMENT_ID` in the environment before running scorer scripts so results link back.

### Aggregation script shape

```typescript
// scripts/aggregate-subagent-results.ts
import { readdirSync } from "fs"

const DIR = process.env.RESULTS_DIR!
const files = readdirSync(DIR).filter(f => f.startsWith("results_") && f.endsWith(".jsonl"))

const all: any[] = []
for (const f of files) {
  const text = await Bun.file(`${DIR}/${f}`).text()
  for (const line of text.trim().split("\n").filter(Boolean)) {
    all.push(JSON.parse(line))
  }
}

// Write combined
await Bun.write(`${DIR}/combined.jsonl`, all.map(r => JSON.stringify(r)).join("\n") + "\n")
console.log(`Aggregated ${all.length} results from ${files.length} files`)
```

### File conventions

| Task | Batch input dir | Results dir | Final output |
|---|---|---|---|
| Continuity pilot | `/tmp/continuity-pilot/` | `/tmp/continuity-pilot/` | manual review |
| Continuity full | `/tmp/continuity-label/` | `/tmp/continuity-label/` | `lora-data/continuity-pairs-labeled.jsonl` |
| Chapter-plan escalation | `/tmp/missing-beat-escalation/` | `/tmp/missing-beat-escalation/` | merged into `lora-data/chapter-plan-checker-pairs-v2.jsonl` |

All intermediate files live in `/tmp/` on LXC. After aggregation, rsync the final combined JSONL back locally before recording in DB:
```bash
rsync novel-harness-lxc:/tmp/continuity-label/combined.jsonl lora-data/continuity-pairs-sonnet-labeled.jsonl
```

---

## Decision Gates

| Gate | Condition | If fail |
|---|---|---|
| Continuity injection validation | ≥85% of pairs per variant have injection present | Fix `generate-continuity-data.ts`, regenerate failing variants |
| Continuity pilot accuracy | Sonnet ≥80% WARNING, ≥80% NIT, ≥95% BLOCKER, ≥90% TRAP/NONE | Investigate injection quality; do not proceed to full run |
| Chapter-plan gpt-oss labeling | ≥88% agreement on PASS variants, ≥48% recall on FAIL_MISSING_BEAT | Expected — proceed to Sonnet escalation |
| Final class balance | PASS:FAIL within 45:55–55:45 | Oversample weak class or generate additional pairs |
| Adapter eval (post-training) | Fine-tuned 14B ≥80% oracle agreement on held-out eval set | Investigate failure mode before production deploy |
