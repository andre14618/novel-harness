---
status: completed
updated: 2026-05-10
role: session-record
lane: upstream-planning-methodology
---

# Runtime Drafting Evidence — 2026-05-10

## L87 Change Packet

- **Phase/surface:** runtime concept -> planning -> drafting evidence, plus a
  read-only session record.
- **Optimized layer:** evidence only. No concept, planner, writer, checker,
  proposal, or UI behavior is changed in this slice.
- **Exact change:** run the current main production path on a disposable
  two-chapter novel and inspect the persisted artifacts/telemetry for scene
  IDs, thread/payoff refs, character-context capsules, chapter endpoint
  satisfaction, listed-character materiality, scene obligation coverage, and
  thread/payoff continuity.
- **Expected benefit/outcome:** identify the next highest-value layer to work
  on from live runtime evidence rather than adding another scaffold or
  heuristic from speculation.
- **Downstream projection:** evidence should show whether failures originate
  in concept seed richness, native chapter planning, scene/obligation mapping,
  writer context, checker review, or UI visibility. Stable refs should flow
  through `sceneId`, obligation/source refs, writer/checker telemetry, and
  chapter drafts.
- **Evidence gate:** one disposable `bun src/index.ts --auto --seed
  fantasy-healer --chapters 2` run, followed by DB inspection of outlines,
  drafts, LLM call tags, pipeline events, and checker findings.
- **Held constants:** current main defaults. `nativePlanningContractV1=true`
  and `writerContextMode=thread-character-context-v1` stay active; default-off
  scene-contract/writer flags stay off. No Playwright, no UI work, no external
  CI, no new creative heuristic.
- **Stop gates:** stop and report if the run bails at a plan-assist gate, DB
  telemetry lacks scene IDs, or drafting does not produce enough persisted
  evidence to classify the next layer.

## Run Notes

### Command

- Experiment row: `480`
- Command: `EXPERIMENT_ID=480 bun src/index.ts --auto --seed
  fantasy-healer --chapters 2 --experiment 480`
- Novel: `novel-1778411555121`
- Central run: `839`
- Wall time: 16m 8s
- LLM calls: 120 total, 1 failed
- API cost: `$0.047797`
- Output: `output/novel-1778411555121/`

### Runtime Result

The current main production path completed end-to-end and persisted approved
drafts for both chapters.

| Chapter | Target | Planned entries | Recommended | Final words | Ratio | Final validation |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| 1 | 1500 | 5 | 5 | 2841 | 1.89x | passed |
| 2 | 1800 | 6 | 6 | 5456 | 3.03x | passed |

Planner-quality diagnostics:

- `overPlannedChapters=0`; the current problem is not beat-count
  overplanning on this run.
- `endpointIssues=2`; both chapters had weak deterministic overlap between
  declared endpoint and final planned entry.
- `weakStoryTurnBeats=3`; these are deterministic flags and need operator or
  semantic review before becoming a rewrite rule.
- Obligation health was valid for both chapters: no missing source IDs, no
  orphan facts, no overloaded obligation chapters.

### Important Findings

1. **Writer expansion is still the live pressure point.** The calibrated entry
   counts held at 5 and 6, yet final prose landed at 1.89x and 3.03x target.
   Do not spend the next slice on more beat-count calibration; inspect writer
   budget/context behavior or scene-call writer evidence instead.

2. **The plan checker caught a real semantic drift.** Chapter 2 initially
   changed the plan from Voss proposing transfer onto a prisoner into transfer
   onto Sylvie herself. That contradicted both the plan and the world rule that
   the healer cannot transfer wounds onto themselves. One targeted rewrite of
   the first entry fixed the plan check.

3. **Thread/payoff lineage is not yet being exercised in this runtime.** The
   persisted outlines had 23 obligations across two chapters, but
   `threadId=0`, `promiseId=0`, and `payoffId=0` on those obligation rows.
   Writer context traces also had empty `activeThreadIds`,
   `activePromiseIds`, and `activePayoffIds`. The lineage substrate exists,
   but this seed/current planner path did not emit the refs needed to test
   cross-thread promise continuity.

4. **Scene IDs exist, but legacy beat tags are still present in this default
   path.** Every outline entry had `sceneId`, and per-entry LLM calls carried
   `scene_id`. Because the current default path is still beat-shaped
   (`scenePlanContractV1=false`, `sceneCallWriterV1=false`), the writer,
   adherence, and hallucination calls also carried `beat_id`. This is
   acceptable only as legacy/beat-specific compatibility; scene-level eval
   reports were adjusted in this session to use `sceneId` as their primary
   identity and expose `legacyBeatId` only when present.

5. **Integrity/lint retries are visible and nonsemantic.** Chapter 1 retried
   after quote-integrity failures; Chapter 2 had a duplicate-fragment issue
   cleared by targeted integrity settle. These are useful mechanical guards,
   but they should not be interpreted as story-quality failures.

### Code Cleanup Performed

Scene replay/parity diagnostics were using `beatId` as the row identity even
though they are scene-level tools. Updated:

- `scripts/evals/scene-semantic-review.ts`
- `scripts/evals/scene-semantic-review.test.ts`
- `scripts/evals/scene-checker-parity-panel.ts`
- `scripts/evals/scene-checker-parity-panel.test.ts`

The in-memory/report identity is now `sceneId`; legacy beat-shaped refs are
kept as optional `legacyBeatId`. DB persistence still writes to
`eval_briefs.beat_id` / `eval_results.beat_id` because that table schema is
older and stores a generic eval item key.

### Next Session Goals

1. Add a small runtime evidence fixture that forces or strongly encourages
   `threadId` / `promiseId` / `payoffId` emission so cross-thread continuity
   can be tested with real refs instead of empty fields.
2. Compare default per-entry writer against the scene-call writer on a
   planner-frozen, two-chapter source where word expansion is visible.
3. Inspect writer context naming: scene-first calls should carry `sceneId`;
   `beatId` should appear only for real beat hints, legacy beat-shaped entries,
   or beat-check compatibility.
4. Treat endpoint landing as the next planner-quality question: deterministic
   overlap flags are useful triage, but promotion requires a narrow semantic
   judge or operator-labeled examples.
