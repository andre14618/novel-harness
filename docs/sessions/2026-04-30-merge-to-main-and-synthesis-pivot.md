---
status: retrospective
updated: 2026-04-30
duration: ~3h (final stretch after compaction; cumulative cross-session work ~12h)
commits: 6 (this session — see §1)
subagents_spawned: 6 (4 mining + 1 doc sweep + 1 Codex pre-merge review)

# ── Workflow telemetry ──────────────────────────────────────────────────
wall_clock_min: 180
codex_reviews: 1
rework_passes: 1
bugs_caught_by_codex: 2
bugs_caught_by_preflight: 0
bugs_escaped_to_prod: 0
preflight_false_positives: 0
---

# phase-variant-screen merge to main + synthesis pivot — 2026-04-30

## 1. What shipped (≤150 words)

Three load-bearing landings: (a) **Patterns 72-75 corpus-mining sweep** — interaction patterns + magic lexicon, P72 PASS_PARTIAL with 3 fellowship pairs cleanly diverging (Bruenor anchors all 3); P73/P74/P75 useful negatives — committed at `788b7a2`. (b) **`phase-variant-screen` branch (188 commits, ~292K insertions) merged into `main` and pushed to origin** — single non-fast-forward merge commit `c8df5a6`, preceded by Codex pre-merge review (`a8bb6556c14c3f098` gpt-5.5) BLOCK on two test-fixture issues, fixed in `69f8c65`. Sync-main + push final commit at `2ccf8e1`. (c) **Synthesis pivot framing established + fine-tune-free directional constraint added to `docs/todo.md`** — voice LoRA + 4 active SFT checkers all in scope for migration to DeepSeek V4 Flash + deterministic guards. Voice-shaping-ablation-v1 (2026-04-21, FLAT verdict) means writer LoRA retirement can probably proceed on existing evidence + a 3-chapter validation novel run. `synthesis-bundle-v1` branch created off updated main; LXC fixture recorder running in background at session-end.

## 2. Architectural iterations with supersession chains

### Chain A: mining wave 4 → synthesis pivot

- **Initial approach:** continue mining unique-territory patterns to expand the 75-pattern catalog (commits `788b7a2` P72-75 sweep, `974c042` doc sweep)
- **Problem discovered:** mining surface saturation — user asked "what mining is even left to do?" and "any unique items we can gain from mining?" The marginal pattern was unlikely to produce a harness lever the existing 75 didn't already cover
- **Superseded by:** pivot to synthesis (composite-prior bundles → variant prompts → phase-eval probes) per the new "Pivot to synthesis" priority block in `docs/todo.md` (committed in the doc sweep `974c042`)
- **Lesson:** mining surface saturation is detectable — when 4 unique-territory candidates produce 3 DIVERGE/KILL and 1 PASS_PARTIAL with concrete levers already identified, the next wave is unlikely to add proportional value. Synthesis is the correct pivot when the catalog is comprehensive across the major surfaces.

### Chain B: atomic_append_section silent loss under N=4 parallelism

- **Initial approach:** trust `atomic_append_section` (flock + O_APPEND in `scripts/structure-calibration/lib/atomic_io.py`) for the 4 parallel mining subagents; rely on each subagent's stdout "appended →" confirmation
- **Problem discovered:** only P72's elaborate section landed in `crystal_shard-conclusions.md`; P73/P74/P75 were silently lost despite all three subagents printing successful append confirmations. All 4 roadmap rows + 4 JSONs landed correctly via `atomic_insert_row_before_anchor` and `write_timestamped_json` — failure was specific to the append helper
- **Superseded by:** manual reconstruction in `788b7a2`. Each missing section was rewritten from the subagent's verdict report into a compact ~80-line summary preserving the load-bearing data; appended sequentially via the same `atomic_append_section` (no concurrency at recovery time). Lessons-learned entry + `docs/todo.md` LOW PRIORITY robustness item committed in `974c042`
- **Lesson:** flock + O_APPEND has a previously-undiagnosed failure mode under N≥3 concurrent macOS/Python processes. Workaround: don't run >2 parallel pattern subagents writing to the same conclusions doc, OR verify post-run with `grep -c "^## Pattern N:" target.md` against the expected count. Durable fix is the conclusions-stubs flow (each subagent writes its own file; single-writer reconciliation step gathers stubs)

### Chain C: branch merge strategy — cherry-pick split → single non-fast-forward merge

- **Initial approach:** identify mining vs modularization commit clusters and cherry-pick split into two passes (Pass A mining → main; Pass B modularization → main)
- **Problem discovered:** chronological audit showed the 186 ahead-of-main commits were heavily interleaved (mining started at sequence #84, modularization extended to #141; first 30 commits were a third bucket of older infrastructure work). Cherry-pick split would hit conflict hell on the docs files that both efforts touched (`docs/lessons-learned.md`, `docs/todo.md`, `docs/current-state.md`, `CLAUDE.md`). Plus `dd4d145` on main was a content-duplicate of `dc867ad` on the branch — same STYLE_PRIMER inventory, different SHAs
- **Superseded by:** single non-fast-forward merge with full granular history preserved + one Codex review pass. Sequence: `1dd9899` sync main into branch (auto-merged docs/harness-optimization-inventory.md cleanly) → Codex review on the runtime-affecting subset → `69f8c65` BLOCK fixes → `c8df5a6` `--no-ff` merge of `phase-variant-screen` into `main` → `2ccf8e1` final TODO + push
- **Lesson:** when concerns interleave chronologically across a long-running branch, a `--no-ff` merge with full history beats cherry-pick split on tractability. One Codex review pass scoped to runtime-affecting files (`src/`, `sql/`, `tests/`, runtime scripts) is sufficient for review hygiene; mining artifacts and pure docs don't need adversarial code review

### Chain D: voice-shaping bundle direction → "validate-and-retire-LoRA" reframe

- **Initial approach:** voice-shaping bundle (P29 + P39 + P57 + P65 + P67) as the first synthesis target; charter to be drafted via `/charter-review` SOP
- **Problem discovered:** read of `docs/charters/voice-shaping-ablation-v1-results.md` (2026-04-21) revealed the voice-shaping question was **already answered with verdict FLAT-vs-D0 + LoRA-has-quality-issues evidence**. Bare DeepSeek V3.2 already scores under 1σ from Salvatore reference on most voice-shape features; Salvatore v4 LoRA leaks corpus tokens at 15% (vs DeepSeek with few-shot Salvatore quotes leaking 0%); Salvatore has a 73× word-count spread (39–2863w outliers) vs DeepSeek's 5× spread. A v2 bundle would partially repeat v1 territory
- **Superseded by:** "validate-and-retire LoRA" framing (Track A) — switch `WRITER_GENRE_PACKS` fantasy → DeepSeek V4 Flash bare, run a 3-chapter novel end-to-end, ship if quality holds. v2 charter stays available as a fallback if Track A reveals specific gaps (most likely dialogueRatio + sensoryDensity per v1)
- **Lesson:** **always read prior charters in the same conceptual space before drafting a new one.** v1 results may already answer the question and converge faster than running a parallel v2. Charter-review SOP (`/charter-review`) catches this when used; direct drafting bypasses the safety check. Adding to the active rule set going forward.

### Chain E: fine-tune scope expansion (writer-only → full SFT inventory)

- **Initial approach:** treat "fine-tune-free direction" as primarily writer-LoRA-retirement
- **Problem discovered:** user reminder mid-conversation: "we fine tuned lora for different checkers as well. we are moving away from voice fine tunes on tiny models and will be relying on other methods for the time being"
- **Superseded by:** full SFT inventory framing — 5 fine-tunes in play (`Salvatore voice LoRA v3` writer, `adherence-checker-v4`, `continuity-v2` deprioritized, `halluc-ungrounded-v2` candidate-not-wired, `halluc-leak-salvatore-v1` candidate-not-wired) + 2 already retired (`chapter-plan-checker` SFT swapped for V4 Flash thinking, `Howard tonal-pass v4` frozen). Two-track plan: Track A = voice LoRA retirement validation; Track B = checker A/B harness + adherence-checker-v4 retirement first (highest call frequency)
- **Lesson:** when user references "fine-tunes," the scope includes checker SFTs not just writer SFTs. The 14B-base SFT family is the migration target as a whole; corpus-mined patterns become deterministic guards that compose with V4 Flash for narrow checks. This is the broader synthesis the mining work feeds into.

## 3. Codex back-and-forth exchanges

1. **Pre-merge review** — Thread `a8bb6556c14c3f098` (codex:codex-rescue gpt-5.5 effort=high)
   - **Original commit claim:** `phase-variant-screen` is ready to merge into main; mining + modularization + supporting work bundled, runtime-affecting subset scoped to `src/phases/`, `src/agents/`, `tests/phase-parity/`, etc.
   - **Codex found:** BLOCK on two test-fixture issues. (1) `tests/phase-parity/replay-transport.ts:15-17,44-52` — `hashRequest()` excluded `extraBody`; the DeepSeek `thinking: {type: "enabled"}` flag rides in extraBody (per `src/llm.ts:447-459`) and is set per-agent in `src/models/roles.ts`; without extraBody in the hash, a fixture recorded with thinking-off would silently match a thinking-on request and replay the wrong response, defeating the parity gate. (2) `tests/beat-context-fixtures/legacy-snapshot.ts:23` — imported `pickExampleLineSubset` live from `src/agents/writer/beat-context.ts`, so the "FROZEN snapshot" baseline mutates with production changes and cannot catch regressions in example-line conditioning. Phase contract / schema drift / removed-but-still-referenced / agent prompt schema all PASS
   - **Fix:** `69f8c65 [fix] phase-parity: address Codex pre-merge BLOCK on test-fixture validity`. Added `canonicalize()` helper that recursively sorts object keys (treats undefined/null as `{}` so existing fixtures with no recorded extraBody still match new requests whose extraBody is empty); included canonicalized extraBody in the hash payload; added extraBody to `RecordedCall.request` type + `RecordTransport` capture path. For the legacy-snapshot, inlined a hand-copy of `pickExampleLineSubset` + its preset tables under the legacy-snapshot module with a comment that future baseline updates must be a separate deliberate commit. 21/21 beat-context-parity tests pass after the inline (byte-equivalent to production helper output)
   - **Sufficient?** Yes for the merge-block fix. Outstanding: re-record the parity fixture on LXC (recording is in flight at session-end at `bwboc2xtk`/`/tmp/record-fixture.log`); the current stale fixture is correctly stale for thinking-on agents and will fail loudly on LXC until re-recorded — the fix turns a silent-green into a deliberate red. Re-recording converts the red back to green. Tracked in `docs/todo.md` "Re-record phase-parity fixture on LXC after merge"

2. **Doc sweep subagent** — `ab8a8277894ed929c` (general-purpose Sonnet)
   - **Original commit claim:** P72-75 wave landed at `788b7a2`; need lessons-learned + current-state + todo updates per Rules 11/14/15
   - **Codex/subagent found:** N/A — this was an in-parallel doc subagent, not a Codex review. It produced commit `974c042` with the lessons entry on the atomic_append_section failure mode + current-state P72-75 verdict block + todo pivot-to-synthesis priority block. Used `docs-impact: none` per commit-conventions
   - **Fix:** subagent's commit landed clean; verified via `grep -c "^## Pattern" crystal_shard-conclusions.md` returning 28 (P72/73/74/75 all individually present post-recovery)
   - **Sufficient?** Yes

## 4. Class-of-bug patterns

- **Stale safety-net bypass** — test fixtures or parity gates that pass for the wrong reason (recorded-state mismatch, live-imported "frozen" baselines). Seen at **2 sites this session** (replay-transport extraBody hash; legacy-snapshot live import). Pattern shape: a guard that's labeled "frozen" or "byte-equal" but actually tracks production through indirect coupling (missing field in hash; live import of a function whose name suggests it's a copy). **Recurs across sessions** (see prior false-green parity-test patterns) — elevate to `docs/patterns/stale-safety-net-bypass.md` if it appears a third time.

- **Atomic-write silent loss under high parallelism** — flock + O_APPEND has a failure mode at N≥3 concurrent macOS/Python processes that produces silent loss of writes despite each writer reporting success. Seen at **1 site this session** (P72-75 atomic_append_section call). Confirmed pattern — first parallel-write failure mode was the merge-conflict-from-raw-`>>` (Patterns 28/32/33/37 earlier this month) which was supposedly fixed by the flock helper; flock helper has its own failure mode now. Worth elevating to `docs/patterns/parallel-append-failure-modes.md` once the durable conclusions-stubs flow ships.

- **Mining surface saturation** — productive mining has a tail where marginal patterns add noise without leverage; synthesis pivot is the next phase. **Seen at 1 site this session** (the post-P75 saturation moment); but matches the broader "experiment-design discipline at maturity" pattern that recurs across the harness's history. Useful generalization: if 4 unique-territory candidates produce a 3-DIVERGE/1-PASS_PARTIAL distribution AND existing patterns already provide concrete levers, stop mining and pivot.

- **Prior-art blindness when drafting in occupied conceptual space** — drafted toward voice-shaping bundle v2 charter without first reading voice-shaping-ablation-v1 results. **Seen at 1 site this session.** Could have wasted significant charter-review cycles. Mitigation: always grep `docs/charters/` for prior work in the same conceptual space before drafting.

## 5. Process observations

The session executed three distinct work modes back-to-back: (1) **wave-4 mining + recovery** (heavy parallel-subagent usage; recovery from atomic-append silent-loss); (2) **branch reconciliation + merge** (audit, Codex review, BLOCK fixes, --no-ff merge, push); (3) **direction-setting** (synthesis-pivot framing, voice-shaping prior-art retrieval, fine-tune-free scope expansion).

Mode-1 used 4 parallel mining subagents + 1 doc-sweep subagent — exactly the parallel-Sonnet pattern from `feedback_parallel_sonnet_subagents`. Five concurrent subagents was at the upper end of the safe N (4 of 4 mining writes were where the atomic-append failure hit; 1 doc-sweep ran cleanly serially after).

Mode-2 used the codex:codex-rescue subagent for a single review pass — `feedback_codex_gpt54_subagents` SOP with `--model gpt-5.5 --effort high`. Notably **did NOT use `/charter-review`** because the merge was not a charter — that's the right tool selection. Codex's BLOCK verdict was acted on without escalation; both fixes were mechanically straightforward (test infrastructure deltas, no production-code touch). The `feedback_act_on_codex_consensus` pattern applied: Codex returns BLOCK with concrete fixes → execute fixes → no need to re-run Codex on the fix.

Mode-3 was conversational direction-setting after the merge landed. The user's signals "do whatever will make it as clear and tracked as possible" + "execute here" + "we don't need to have a ton of reviews" mapped to a high-trust autonomy mode where I drove the merge sequence directly. The fine-tune-free direction emerged in dialogue, not pre-planned — captured in `docs/todo.md` `2ccf8e1` immediately per Rule 15.

The doc-subagent pattern (Rule 11) ran in parallel with my next-phase work — kicked off after `788b7a2` while I was already starting the branch-merge audit. The subagent's `974c042` commit landed cleanly without my review, which is the intended shape — Rule 11 doc subagents don't block primary execution.

One process gap surfaced: **prior-art blindness** when starting a synthesis charter. The mitigation should be a simple `grep docs/charters/` step at the top of every charter-drafting flow. Will add to memory.

## 6. Open questions / next-session focus

**In-flight at session handoff:**

- **LXC fixture recorder still running** at session-end (background bash ID `bwboc2xtk`, log at `/tmp/record-fixture.log` on LXC, process PID 898208 on LXC). Was at chapter 1 beat 6/12 of 3-chapter `fantasy-system-heretic` run; expect ~5-10 more minutes. Next session: SSH to LXC, verify completion, rsync `tests/phase-parity/fixtures/reference-run/{transport-fixture,expected-snapshot,seed}.json` back to local, commit + push. Closes the `docs/todo.md` "Re-record phase-parity fixture on LXC after merge" item.
- **Logging gap noticed during recorder run:** `[logger] logLLMCallStructured called with no currentRunId — dropping ... call for novel fantasy-system-heretic`. The recorder doesn't establish a currentRunId so per-call telemetry isn't being persisted to `public.llm_calls`. Recorder works correctly for fixture purposes (writes to its own JSON), but if production runs ever lose currentRunId the same way, telemetry would silently drop. Worth a future audit; not blocking.

**Branch state:**

- `main` is at `2ccf8e1`, pushed to origin
- `synthesis-bundle-v1` branch created off main (empty); workspace for the next-phase bundle work
- `phase-variant-screen` is now historical; do not branch from it again — branch from `main` for new work

**Tasks alive at handoff:**

- `#147 Deploy + LXC fixture re-record` — in-progress, recorder running
- `#149 Scaffold measurement infrastructure` — pending; **deferred** until Track A direction confirmed (see below)
- `#150 Draft voice-shaping bundle charter` — was in-progress but **superseded** by Chain D reframing. Don't draft a v2 charter yet — Track A first

**Two-track synthesis plan, awaiting user direction at start of next session:**

- **Track A (recommended first move):** validate-and-retire Salvatore voice LoRA. Switch `WRITER_GENRE_PACKS` fantasy → DeepSeek V4 Flash bare in `src/models/roles.ts`; deploy; run 3-chapter `fantasy-system-heretic` (or any fantasy seed); read prose; ship if quality holds. v1 evidence (`docs/charters/voice-shaping-ablation-v1-results.md`) supports this. ~30 min total work + 1 LLM-call cost
- **Track B (second move):** checker A/B harness + `adherence-checker-v4` retirement. Build generic "compare same-prompt-same-inputs across two models" tool; A/B SFT vs V4 Flash on held-out adherence eval set; if label agreement ≥90%, swap. Then continuity-v2 retirement (deprioritized, easy), halluc-v3 pair decision (don't wire SFTs)

**If you're reading this on the next session, start here:** (1) Check the LXC recorder finished cleanly, sync the fixture back, commit + push. (2) Confirm Track A direction with the user (the user authorized "fine-tune-free direction" + "let's synthesize and figure out how to improve harness"; voice-LoRA retirement is the cheapest first validation of that direction; v1 evidence already supports it). (3) If user confirms Track A, edit `src/models/roles.ts` `WRITER_GENRE_PACKS` fantasy entry → DeepSeek V4 Flash bare, deploy, run a 3-chapter fantasy novel, read it. (4) Track B starts whenever Track A ships or is paused. Do **NOT** draft a voice-shaping-v2 charter without first re-reading `docs/charters/voice-shaping-ablation-v1-results.md` — that's the prior-art-blindness anti-pattern flagged in §4.
