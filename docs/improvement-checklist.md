# Harness Improvement Checklist

Organized by capability level required to drive the iteration loop. Each item includes what to measure, how to test, and current status.

## Tier 0: No LLM Required (Script/Config Only)

These are mechanical — run a script, read numbers, change a value.

- [ ] **Establish planning baselines** — Run `bun benchmark/planning/run.ts` across all seeds, record first numbers. No prompt changes needed, just measurement.
  - Dimensions: Beat Specificity, Dialogue Cues, Emotional Arc
  - Status: Rubrics defined, never run at scale

- [ ] **Establish extraction baselines** — Run `bun benchmark/extraction/run.ts` on existing novel output.
  - Dimensions: Completeness, Accuracy
  - Status: Rubrics defined, never run at scale

- [ ] **Measure lint false positive rate** — Human review of `getPatternStats()` output. For each pattern, check 5 flagged instances: is the flag correct?
  - Status: 35 patterns, 128 total hits, 0 reviewed for precision

- [ ] **Consolidate duplicate judge rubrics** — `dialogue.md`, `telling.md`, `sensory.md` overlap with the penalty rubrics. Delete or merge redundant ones.
  - Status: 5+ rubric files, only 3 in standard suite (telling, dead-weight, dialogue-problems)

- [ ] **Cost optimization sweep** — Run `bun scripts/cost-summary.ts --global`, identify most expensive agents, check if cheaper models have parity.
  - Status: Per-agent cost tracked but not analyzed for savings

## Tier 1: Haiku-Level (Templated Changes, Structured Feedback)

These follow a rigid pattern: read score → read flagged issue → add/modify rule in prompt. A small model can do this reliably because the feedback is concrete.

- [ ] **Add lint-informed rules to writer prompt** — For each high-hit lint pattern (seemed-to: 31 hits, could-see: 29, could-feel: 21), add a corresponding craft rule to `src/agents/writer/prompt.md`.
  - Measure: Re-run lint after prompt change, count hits
  - Model: Haiku can map "pattern X has N hits" → "add rule about X"

- [ ] **Temperature sweep per agent** — For each agent, run 3 temperatures (0.5, 0.7, 0.9) on same seed, compare output quality.
  - Measure: Use existing benchmark dimensions
  - Model: Haiku can write the experiment batch config and read results

- [ ] **Lint Tier 3 patterns** — Add said bookisms and declared emotions patterns. Currently 0 hits on stored prose (writer avoids them), but needed as guardrails.
  - Measure: Hit rate on future generations
  - Model: Haiku can write regex patterns following Tier 1/2 format

- [ ] **Pipeline config tuning** — Test maxDraftAttempts=5, maxValidationPasses=5 on full novel runs. Measure: does more retrying improve final quality or just burn cost?
  - Measure: Final validation pass count, issue count at completion
  - Model: Haiku can run and compare

## Tier 2: Sonnet-Level (Analytical Reasoning, Pattern Recognition)

These require understanding *why* something scores poorly and making a targeted fix. The feedback loop is: read judge reasoning → identify the pattern → modify the prompt to address it.

- [ ] **Writer prompt: methodology integration (Scene/Sequel)** — Add Weiland's Scene/Sequel structure to writer craft rules: GOAL→CONFLICT→DISASTER then REACTION→DILEMMA→DECISION.
  - Measure: Penalty scores + pairwise comparison before/after
  - Model: Sonnet can read methodology docs, extract the rule, write the prompt addition
  - Status: Documented in methodology report as Tier 1 item

- [ ] **Planning-plotter: Five Commandments** — Add Story Grid's per-scene checklist (Inciting Incident, Progressive Complication, Crisis, Climax, Resolution) to planning prompt.
  - Measure: Beat Specificity benchmark dimension
  - Model: Sonnet can implement this from methodology report

- [ ] **Planning-plotter: dialogue cue specificity** — Current beats say "characters talk." Improve to include subtext notes, power dynamics, what's unsaid.
  - Measure: Dialogue Cues benchmark + downstream Dialogue Problems in prose
  - Model: Sonnet can analyze weak beats and write better examples

- [ ] **Rewriter precision measurement** — After rewriter runs, re-judge the same dimensions. Did issues go down? Did new issues appear?
  - Measure: Delta in penalty scores pre/post rewrite
  - Model: Sonnet can build the comparison script and interpret results

- [ ] **Context builder enrichment** — Add previous chapter's emotional throughline to writer context. Add theme context to rewriter. Add character voice summary to prose-quality checker.
  - Measure: Pairwise comparison with/without enriched context
  - Model: Sonnet can identify what's missing from context and add it

- [ ] **Dialogue Problems rubric fix** — This dimension inverts across runs (+-5.0 variance). Either tighten the rubric to reduce ambiguity, or replace with a more stable measurement.
  - Measure: Variance reduction across 5+ runs
  - Model: Sonnet can analyze which sub-criteria cause instability

- [ ] **Create continuity checker fixtures** — Write 5-10 JSON test cases with planted contradictions (timeline errors, location impossibilities, character knowledge violations).
  - Measure: Detection rate, false positive rate
  - Model: Sonnet can generate realistic test cases from existing novel output
  - Status: **BLOCKER** — cannot measure continuity agents without this

- [ ] **Extraction accuracy test cases** — Take 5 existing chapters, manually identify key facts, compare to extractor output.
  - Measure: Precision and recall of fact extraction
  - Model: Sonnet can do the comparison

## Tier 3: Opus-Level (Craft Understanding, Creative Judgment)

These require deep understanding of prose craft — knowing what makes writing work at a level beyond pattern-matching from judge feedback.

- [ ] **Writer prompt: show-don't-tell craft rules** — Beyond mechanical rules ("don't use filter words"), improve the prompt with craft-level guidance: how to dramatize internal conflict through action, how to use environment as emotional mirror, when telling is actually the right choice.
  - Measure: Penalty scores + pairwise + human reading
  - Model: Needs genuine prose craft understanding

- [ ] **Character voice differentiation** — Ensure each character in a scene has distinct speech patterns, vocabulary, sentence structure. Current character profiles include speech patterns but the writer doesn't consistently use them.
  - Measure: Pairwise comparison on dialogue-heavy seeds, human eval
  - Model: Needs understanding of voice as a literary technique

- [ ] **Pacing and structure** — Measure whether chapters have appropriate narrative rhythm (tension/release, scene/sequel alternation). No benchmark dimension exists for this yet.
  - Measure: New rubric needed — requires craft-level rubric writing
  - Model: Needs understanding of narrative structure

- [ ] **Genre convention compliance** — Does romance-drama follow Love genre conventions? Does dark-fantasy maintain horror beats? Currently no genre-specific validation.
  - Measure: Genre-specific rubrics (per Story Grid genre analysis)
  - Model: Needs understanding of genre conventions at structural level

- [ ] **Subtext quality** — Measure whether dialogue carries meaning beyond its surface. Characters should talk around the real issue, not state it directly.
  - Measure: New rubric + human eval. Hard to judge with LLM alone.
  - Model: Opus — this is one of the hardest prose craft skills to evaluate

## Automation Candidates

Items that could run in an unattended loop with the right model:

| Loop | Model | Items | Cycle |
|------|-------|-------|-------|
| **Lint-to-prompt** | Haiku | Run lint → find top pattern → add writer rule → re-lint | 5 min |
| **Penalty-to-prompt** | Sonnet | Run benchmark → find weakest dim → read judge issues → modify prompt → re-run | 15 min |
| **Pairwise A/B** | Sonnet | Make change → generate → pairwise compare → keep/revert | 10 min |
| **Planning baseline** | Haiku | Run planning benchmark → record numbers → no changes needed | 5 min |
| **Model swap test** | Haiku | Swap model in roles.ts → run benchmark → compare to baseline → record | 10 min |
| **Full craft iteration** | Opus | Analyze weak dimensions → understand root cause → rewrite prompt section → test → evaluate | 30 min |

## Priority Order

1. **Establish baselines** (Tier 0) — Can't improve what you can't measure
2. **Create continuity fixtures** (Tier 2) — Unblocks two agents
3. **Methodology integration** (Tier 2) — Highest-leverage prompt changes
4. **Lint-to-prompt loop** (Tier 1) — Cheapest automated improvement
5. **Dialogue rubric fix** (Tier 2) — Unreliable dimension hurts all experiments
6. **Craft-level prompt work** (Tier 3) — Diminishing returns, save for last
