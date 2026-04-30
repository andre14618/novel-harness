---
status: retrospective
updated: 2026-04-30
duration: ~6h
commits: 42
subagents_spawned: 31

# ── Workflow telemetry ──
wall_clock_min: 360
codex_reviews: 0                    # mining session, no Codex review
rework_passes: 2                    # P28 ADDENDUM restore + P3b plotter regression flagged
bugs_caught_by_codex: 0
bugs_caught_by_preflight: 1         # schema-prompt enum mismatch caught on LXC probe
bugs_escaped_to_prod: 0
preflight_false_positives: 0
---

# Corpus mining + Rule 14/15 codification + 6 patterns in-flight — 2026-04-30

## 1. What shipped (≤150 words)

A 30+ pattern corpus mining sweep of the Salvatore Icewind Dale 3-book bundle (92 chapters / 2,470 beats / 405 scenes), with Patterns 22-41 caught up into the roadmap, P42 (punctuation) + P48 (dialogue tags) added, and **6 more (P49-P54) running in parallel as the session ends**. Two new CLAUDE.md rules codified: **Rule 14** (lessons captured at moment of methodology surprise) committed in `d492d61`; **Rule 15** (findings must land in tracked docs in-session) committed in `11a8178`. Schema-prompt enum mismatch fixed (`0c8457d`). Critical methodology lesson: directional gate (ranking / modal class / sign-of-effect) was added on top of point-estimate gate (±20%) — patterns can pass directionally while diverging numerically. The full PASS-eligible lever stack is now 12+ ship candidates spanning planner / writer / lint surfaces.

## 2. Architectural iterations with supersession chains

### Chain A: point-estimate gate → directional re-score (append, don't overwrite)

- **Initial approach:** original 7 patterns (P1-P7) were point-estimate-gated (±20% spread across books → PASS). Crude binary verdict, lost signal.
- **Problem discovered:** several patterns were point-estimate-DIVERGE but directionally stable (modal class agreed; sign-of-effect agreed). Throwing them out lost real signal.
- **Superseded by:** dual-gate methodology — point-estimate verdict stays as historical record, directional re-score appended via `scripts/structure-calibration/directional-rescore-original-7.ts` (committed in `558c344`). User explicitly requested: "an appendation type of score because I don't think that getting rid of the evidence of the research and how we did it is the right play."
- **Commit refs:** `558c344` original-7 directional re-score; per-pattern row updates throughout the session.
- **Lesson:** always preserve the original verdict and append the re-score with a methodology note. This is now codified as **`feedback_no_overwrite_runs.md`** (timestamped output filenames + append-only conclusions docs).

### Chain B: aggregate-only patterns surviving while per-book patterns fail

- **Initial approach:** P32 foreshadow→time-cut compositional pattern showed strong aggregate signal (3.6× lift book-1).
- **Problem discovered:** when broken out per-book, the lift was crystal-shard-only (3/0/0). Rest-of-trilogy showed zero compositional fire. An aggregate "PASS" was lying about reproducibility.
- **Superseded by:** per-book directional gate became mandatory — verdicts can no longer be issued from aggregate-only data. Captured as lesson `feedback_perbook_gating_required` (committed `c0ff3c7`).
- **Commit refs:** `c0ff3c7` lessons; throughout — every subsequent subagent prompt required cross-book directional gating.
- **Lesson:** aggregate stability ≠ per-book stability. **Per-book gating first; aggregate as supplemental.** Already an entry in lessons-learned.

### Chain C: parallel-subagent race conditions on append-only docs

- **Initial approach:** subagents wrote section appends to `crystal_shard-conclusions.md` and roadmap rows via `Edit` tool; assumed serializable.
- **Problem discovered:** P28 ADDENDUM was clobbered by P32 commit (`7e5de0f` restore needed). P33/P37 hit same race. 2 lost-data incidents this session.
- **Superseded by:** atomic write-then-rename pattern + `fcntl.flock` for shared append-only docs. Subagent prompts now mandate Python `flock` over the conclusions doc and the roadmap insertion.
- **Commit refs:** `7e5de0f` restore; `c0ff3c7` lesson; all subsequent prompts (P49-54) updated.
- **Lesson:** any time N parallel agents write to a single append-only doc, atomic-append is mandatory. Already an entry in `lessons-learned.md`.

### Chain D: Rule 14 + Rule 15 codification (process pivot)

- **Initial approach:** "I'll capture the lesson at session-end via the doc subagent" + "I'll summarize the finding in chat and trust the user to read it."
- **Problem discovered (twice):** P26 false-negative finding (Sonnet anchor revealed DeepSeek V4 Flash was under-flagging compositional pairs at 25%) was almost lost — user prompted: "we need to always capture lessons learned please force that behavior in claude.md etc." Then findings P28-P41 were narrated in chat but not roadmap-rowed — user prompted: "this must be a rule to keep track of data and context."
- **Superseded by:** **Rule 14** (`d492d61`) — same-commit lesson capture at moment of methodology surprise. **Rule 15** (`11a8178`) — per-finding cadence for tracked docs, not session-end batch. Catch-up roadmap commit `4ede0f4` cleared the backlog.
- **Commit refs:** `d492d61` Rule 14 + P26 lesson; `11a8178` Rule 15; `4ede0f4` Rule 15 catch-up.
- **Lesson:** when the user has to repeat a process correction, the rule belongs in CLAUDE.md, not in chat memory. **Both rules promoted to standing rules.**

### Chain E: schema-prompt drift caught by LXC probe

- **Initial approach:** `MICE_ACTIVE_THREADS` was reduced to `["I"]` only, but the planner prompt still listed `('I'|'C'|'E')[]` as the schema for `miceActive`.
- **Problem discovered:** LXC probe of the planning-beats variant emitted `miceActive=['E','C']` and failed schema validation.
- **Superseded by:** `0c8457d` synced `beat-expansion-system.md` enum to match the production schema.
- **Commit refs:** `0c8457d`.
- **Lesson:** schema-prompt sync is a recurring class-of-bug. There's an existing memory entry `feedback_schema_of_record_check.md` covering this; this session was a real example. Worth elevating to a `docs/patterns/schema-prompt-sync.md` if it recurs again.

## 3. Codex back-and-forth exchanges

**Zero Codex reviews this session.** This was a mining session — the work shape was parallel-subagent measurement + atomic doc append, no architectural decisions requiring divergent-model review.

If there's a Codex review queued for the next session, it's the bundle-decision: should the PASS-eligible lever stack be wired into v2 plotter + v2 beats variants and re-probed as one bundled change, OR should each lever be screened in isolation? That question SHOULD be Codex-reviewed before commit (charter-class question — affects multiple harness surfaces).

## 4. Class-of-bug patterns

- **Append-only race conditions** — seen at 4 sites this session (P28, P32, P33, P37). Mitigated mid-session via flock pattern in subagent prompts. **Recurs across sessions** (this is the second time this class has appeared in retros — first appearance was during voice-LoRA training data generation). **Elevation candidate** for `docs/patterns/parallel-append-only.md`.
- **Aggregate-vs-per-book signal collapse** — seen at 1 site this session (P32). Already a lesson; flagged as a class to watch.
- **Schema-prompt drift** — seen at 1 site this session (P0c8457d). Already an existing lesson — `feedback_schema_of_record_check.md`. Recurring class.
- **Low-prevalence LLM under-flagging** — seen at 1 site (P26 compositional pairs at 2.5% via DS V4 Flash, 10.1% via Sonnet anchor). Already a lesson; primary-axis 92.4% agreement was OK, but **multi-axis dimensions need hand-spot before treating final**.

## 5. Process observations

This session's primary work-shape was **parallel mining at high concurrency**. 31 subagents spawned across the day, mostly in batches of 5-6 (respecting the parallel-batch limit of ~10-15 per `feedback_parallel_batch_limit.md`). Each subagent produced ~3 deliverables: timestamped JSON, atomic-append to conclusions doc, atomic-append to roadmap. The conclusions doc is now ~3839 lines.

The doc-subagent pattern (Rule 11) fired twice this session — once mid-session for current-state catch-up, once at end-of-session (still in flight as I write this). The Rule 11 cadence works: doc subagents in parallel with the next implementation chunk hide the doc-update latency entirely.

Two **process pivots** emerged this session, both via user feedback:
1. **Lesson capture must be in-session, not post-hoc** (Rule 14). The trigger surface is now in CLAUDE.md.
2. **Findings must hit tracked docs at the per-finding cadence, not end-of-session batch** (Rule 15). Chat summaries die.

Both rules are about **decay rate of session memory** — chat dies, code persists, docs persist longer. The chat → doc translation has to happen in the same commit window as the work, otherwise it's lost.

The directional vs point-estimate methodology shift was load-bearing. ~10 patterns flipped verdict from DIVERGE to PASS_PARTIAL or PASS once re-scored directionally. Without that shift, the roadmap would have been substantially weaker.

## 6. Open questions / next-session focus

**Immediate (after P49-P54 return — should be ~10-30 min after this doc lands):**

1. **Final commit sweep** — task #120. Atomic commit of all P49-54 outputs:
   - `scripts/structure-calibration/{chapter-opener,chapter-closer,scene-break-cadence,pov-distribution,sensory-mode-density,time-skip-markers}.{ts,py}`
   - `novels/salvatore-icewind-dale/structure-calibration/crystal_shard.<TS>.*.json` (6 new JSON files)
   - `novels/salvatore-icewind-dale/structure-calibration/crystal_shard-conclusions.md` (6 new sections appended)
   - `docs/harness-tuning-roadmap.md` (6 new rows for P49-54)
   - Verify roadmap rows are in correct order (49 → 50 → 51 → 52 → 53 → 54), not interleaved by race
   - Verify conclusions sections are ordered (or note any out-of-order from concurrent appends)

2. **The bundle-vs-single-lever decision** — once all 30+ patterns have verdicts, the harness has a stack of PASS-eligible levers spanning:
   - **Writer-prompt priors** (P39 opener-mix per kind, P40 plot-owner dialogue mass, P42 punctuation density, P48 dialogue-tag distribution, plus P49/P53 if they pass)
   - **Lint rules** gated to fantasy-Salvatore (P42 ellipsis/parenthetical/em-dash, P48 said-ratio + alt-tag-repeat, plus P53 if it passes)
   - **Chapter-outline priors** (P41 per-quartile callback density, plus P49/P50/P51/P52/P54 if they pass — these are the highest-leverage planner-surface levers left)
   - **Schema additions** (P40 `chapterPlotOwner`, plus P52 `pointOfView` constraint if it passes)

   **Decision:** ship them all into v2 plotter + v2 beats variants in one bundle and re-probe (faster path, but if v2 fails diffusely you can't isolate signal), OR one-lever-at-a-time screens (slower, cleaner attribution). My recommendation in the previous turn was bundle first, ablate from v2 if it fails. **This is a charter-class decision and should be Codex-reviewed before commit.**

**Pre-existing:**

- **Fix Pattern 3b plotter regression** before any re-probe (`e9a614b` flagged 3b REGRESSED on LXC probe). Until this is fixed, plotter variant probes are noisy.
- **Generalize `print-screen-verdict.ts`** for arbitrary variant pairs (currently hardcoded to one variant comparison shape).
- **Soften beats variant from rank-ordered to set-based** per directional re-score — the existing variant prompt enforces strict ranking when only modal-class stability is corpus-validated.
- **Re-measure Pattern 16 facts density** on 5+ chapters (single-chapter sample was undersized).
- **Concurrent Codex research** (deferred from earlier session) — `feedback_codex_plugin_subagentic_concurrency.md` notes "don't spawn parallel codex exec subprocesses without researching the supported pattern."

**If you're reading this on the next session, start here:**

The last thing I did was launch 6 background subagents (P49-P54) via the `Agent` tool with `run_in_background: true`. They write outputs atomically to:
- `novels/salvatore-icewind-dale/structure-calibration/crystal_shard.<UTC>.<slug>.json`
- `novels/salvatore-icewind-dale/structure-calibration/crystal_shard-conclusions.md` (flock-protected appends)
- `docs/harness-tuning-roadmap.md` (flock-protected row insertions before the `**Sequencing` anchor)

Once they all finish (you'll get notifications), do `git status` and verify:
1. 6 new scripts under `scripts/structure-calibration/`
2. 6 new JSON files under `structure-calibration/`
3. 6 new sections in `conclusions.md`
4. 6 new rows in roadmap (numbered 49-54, all under `**Sequencing` header)

Then commit them as one atomic sweep with a `[data]` commit. Then prompt the user for the bundle-vs-single-lever decision, OR — if user's intent is clear from prior chat — proceed with the bundled v2 path and submit a Codex review.

The branch is `phase-variant-screen`. Main is `main`. ~178 commits on this branch since main. Active queue table in `docs/harness-tuning-roadmap.md` is the canonical pattern-tracking surface; do not duplicate work there.

`docs/current-state.md` was refreshed in this session by the doc-subagent (commit pending in the sweep).
