---
status: retrospective
updated: 2026-04-19
duration: ~5h
commits: 15
subagents_spawned: 7

# Workflow telemetry (mandatory)
wall_clock_min: 300
codex_reviews: 10
rework_passes: 3
bugs_caught_by_codex: 9
bugs_caught_by_preflight: 1
bugs_escaped_to_prod: 1
preflight_false_positives: 0
---

# Workflow overhaul + non-blind-retry hardening — 2026-04-19

## 1. What shipped (≤150 words)

Second half of 2026-04-19, follow-on to the exhaustion-handler session
(see `docs/sessions/2026-04-19-exhaustion-handler.md`). 15 commits across
three bundles: Round A hardening (revisionUsed persistence + test-harness
race fixes + cleanup-orphans), Round B (V2 transport interceptor Phase 1
coexisting with V1 + organic-run-verify + post-settle validation-check
trace + doc supersession continuation), and workflow overhaul
(implement-ticket skill doc + session telemetry mandate + experiment
tracking Phase 0 + in-flight registry + session-handoff.md +
WorkflowPage UI). Codex final verdict: `ab0b2dcea718737cf`
RESIDUAL_WORK_2 — session arc shipped; V2 Phase 2 (V1 retirement) and
scripts/status.ts + codex-preamble deferred as explicit next-session
items.

## 2. Architectural iterations with supersession chains

### Chain A: revisionUsed persistence — fire-and-forget → await-then-flip

- **Initial approach:** Fire-and-forget `.catch(...)` on `setRevisionUsed`
  with local flag flip FIRST (commit `0c9b1ef`)
- **Problem discovered:** Codex thread `aad6d3503db164b1f` HIGH A —
  if the DB write rejects, reviser still runs, saveChapterOutline writes
  the revised outline, but revision_used stays FALSE → restart allows a
  second reviser call
- **Superseded by:** Await DB write BEFORE local flag flip; throw on
  failure rather than fire reviser blind (commit `0c9fa3b`)
- **Lesson:** Fire-and-forget is only safe if the follow-up write is
  compensating. When the guard IS the write, await it.

### Chain B: R3 test-harness race — trace-event match → DB polling

- **Initial approach:** Wait for `trace:debug-inject` OR `trace:plan-check-outcome`
  after decide POST before querying `chapter_outlines` (commit `f1f844f`)
- **Problem discovered:** Codex `aad6d3503db164b1f` HIGH B — both events
  fire at attempt top BEFORE the edit-plan branch saves the outline, and
  watchForExpectations replays full trace history → stale pre-edit event
  satisfies the match, DB read races saveChapterOutline
- **Superseded by:** Poll `chapter_outlines.outline_json.scenes[0].description`
  directly for the unique replacement-beat marker; 30s timeout (commit `0c9fa3b`)
- **Lesson:** Don't use trace events as "happened after X" signals when
  the event system replays history on connect.

### Chain C: Organic-run env paranoia — local-only → orchestrator probe

- **Initial approach:** Script aborts on local `DEBUG_FORCE_*` env vars (commit `a1f4842`)
- **Problem discovered:** Experiment #238 FAILed — orchestrator had
  `DEBUG_FORCE_PLAN_CHECK=fail` in its systemd drop-in from earlier
  R-campaigns. Payload confirmed: `forcedPlanCheck=true, source="forced-recheck-synth"`
- **Superseded by:** New `GET /api/health/debug-flags` endpoint + script
  probes it at startup and aborts on any non-null flag (commit `687e651`)
- **Lesson:** Orchestrator process env ≠ client shell env. Paranoia
  checks against your own env don't catch contamination in the target
  system you're validating.

### Chain D: In-flight registry schema — PID-only → PID + verify_pattern + host_boot_id

- **Initial approach:** `{run_id, kind, pid, host, ...}` (commit `e8886c1`)
- **Problem discovered:** Codex thread `ac9d7f955daf2511d` Q1 — PID
  alone is not durable across host reboots or PID reuse. No way for the
  prune command to do deterministic health checks.
- **Superseded by:** Added `verify_pattern` (pgrep fragment) + `host_boot_id`
  (/proc/sys/kernel/random/boot_id); prune command distinguishes
  alive/ghost/reboot/unchecked (commit `687e651`)
- **Lesson:** Runtime identity of a process is triple: (PID, boot_id,
  cmdline). Any one missing makes cross-session verification unreliable.

### Chain E: Workflow automation — autonomous loop → skill doc only

- **Initial approach:** Full autonomous `/loop` runtime that picks
  tickets + runs phases + escalates (my original Lever 4 framing)
- **Problem discovered:** Codex `a65ba6ef7290fdf25` — recreates the
  "free-running review gate" failure mode warned against in
  `docs/codex-usage.md`. Surface area too large.
- **Superseded by:** Documentation-only skill at
  `.claude/skills/implement-ticket.md`. User picks tickets; Claude
  follows the phases by hand; the doc captures the pattern.
- **Lesson:** Some patterns are worth documenting even if you never
  automate them. The doc is the artifact; automation is an optimization.

### Chain F: Invariants — debug-only toggle → blocking preflight gate

- **Initial approach:** Invariants behind `DEBUG_INVARIANTS=true` env
  flag (my original workflow memo framing)
- **Problem discovered:** Codex `ad350aa657ec1c9b1` Q6 — if invariants
  stay debug-only, they become theater. Same class of bugs keeps
  reaching Codex review.
- **Superseded by:** Invariants become BLOCKING preflight gates with a
  short-term allowlist for intentional violations (skill doc Phase 5
  amendment)
- **Lesson:** Shift-left only works if the "left" gate actually stops
  the ship. Non-blocking safety checks tend toward zero over time.

## 3. Codex back-and-forth exchanges

Numbered in order they occurred today:

1. **Thread `aad6d3503db164b1f`** (Round A post-impl)
   - Original claim: Round A shipped; revisionUsed persisted; R3/R4 races fixed; cleanup-orphans safe
   - Codex found: 3 HIGH — fire-and-forget DB write race; R3 trace-replay race; 4 missing FK tables in cleanup-orphans
   - Fix: `0c9fa3b`
   - Sufficient? yes — re-review thread `ac5ae1215077a1bee` all CLOSED, PASS @ 90%

2. **Thread `add543640220037e1`** (Round B plan-review)
   - Original claim: Round B plan sound, dispatch 3 parallel subagents
   - Codex found: CHANGE — non-test-ID guard ambiguity; equivalence criterion needs to be pinned
   - Fix: embedded Codex decisions (relaxed ID guard via DEBUG_ENABLE_INJECTION hard-404; equivalence = "same terminal trace events + same outcomes") directly into the B1 subagent brief
   - Sufficient? yes

3. **Thread `a1f0d145132145414`** (Round B impl, hot-review pattern)
   - Original claim: Round B shipped clean
   - Codex found: 2 MEDIUM — debugContext enrichment outside try/catch; organic-run-verify missing V2-store probe. M3 per-kind Zod validation deferred with rationale.
   - Fix: `c0704bd`
   - Sufficient? yes

4. **Thread `a65ba6ef7290fdf25`** + **`ad350aa657ec1c9b1`** (workflow overhaul)
   - Strategic analysis of 5 latency levers → overhaul validation of my proposed ordering + 3 CHANGE adjustments (plan-triage I/O contract; drop 2 telemetry fields + add 1; invariants MUST be blocking)
   - Fix: all adjustments embedded in `a0d396e` skill doc + TEMPLATE.md
   - Sufficient? yes — acted without further iteration

5. **Thread `ac9d7f955daf2511d`** (scaffolding design review)
   - Original claim: in-flight registry + session handoff shipped
   - Codex found: Q1 CHANGE (missing verify_pattern + host_boot_id); Q2 CHANGE (session-start receipt); Q5 CHANGE (prune command for ghost accumulation)
   - Fix: `687e651`
   - Sufficient? yes

6. **Thread `a55872a3da0f94887`** (pre-kickoff GO/NO-GO)
   - Verdict: GO @ 100%. One advisory (LXC resource probe).
   - Action taken: probed disk/mem/load before kickoff.

7. **Thread `ab0b2dcea718737cf`** (final session-close)
   - Verdict: RESIDUAL_WORK_2. Session arc shipped; two known-deferred items (V2 Phase 2 V1 retirement; scripts/status.ts + Codex preamble).
   - Ongoing? yes — both deferred to explicit next-session items.

## 4. Class-of-bug patterns

- **In-memory state that must survive restart** — seen at 1 new site
  (`revisionUsed`) this session. Already has pattern doc at
  `docs/patterns/in-memory-state-restart-data-loss.md`. 5th documented
  instance across sessions — pattern is well-established.
- **Trace-replay event race** — new pattern. Using persisted trace
  events as "happened after" signals fails when the event system
  replays history on connect. Seen at 1 site this session (R3).
  First-seen-only until recurrence; don't elevate yet.
- **Orchestrator env ≠ client env contamination** — new pattern. Scripts
  that validate "clean state" must probe the target system's env
  explicitly. Seen at 1 site this session (experiment #238 FAIL).
  First-seen-only.
- **Fail-open must wrap ALL paths** — seen at 1 new site
  (`debugContext` enrichment in llm.ts). Same class as earlier Promise
  constructor + seam-recheck asymmetry; could eventually elevate to a
  "fail-open coverage" pattern if it recurs.

## 5. Process observations

~300 words.

**The workflow pattern is emergent, not designed.** It came out of a day
of iterating with Codex, not a whiteboard session. That's why the skill
doc feels right — it's documented after-the-fact what was working. The
failure mode to avoid next session is letting the doc become prescriptive
rather than descriptive; if the pattern stops working, change the pattern
first, then change the doc.

**Preflight earned its seat.** The single typecheck catch (retryErrors
widening, `ef4aa1b`) is the Lever 3 validation. That bug would have
shipped if Codex had been the first review; instead preflight caught it
in 3 seconds, no Codex cycle spent.

**Parallel subagents are the multiplier, not Codex.** Round A took ~15
min of wall-clock for 3 parallel subagents vs. a sequential ~60-90 min.
Round B same shape. The Codex cycles (3-8 min each) are the fixed cost
of quality; the subagent parallelism is the variable cost of speed.

**The session-start receipt (Codex Q2) is the only enforcement lever we
have for a documentation-only skill.** Without a runtime hook, the
receipt at the top of every session is what makes Phase -1 visible.
Worth monitoring next session to see if it actually gets used.

**Telemetry will take 3-5 sessions to be useful.** This session's
numbers (10 Codex reviews, 3 rework passes, 9 bugs-caught-by-Codex, 1
by preflight) are interesting but sample-starved. The comparative
value kicks in once we have a baseline.

**Codex's recommendation to DEFER the autonomous loop was right.** Every
attempt at autonomy (even scoped single-ticket) has an expanding surface
area. Documentation is the lower-risk artifact that still captures the
pattern.

## 6. Open questions / next-session focus

- **Codex preamble doc** (`docs/codex-preamble.md`) — ≤200 lines,
  regenerated from repo HEAD on every Codex call (Codex Q3 guidance in
  `ac9d7f955daf2511d`). Not a narrative mini-doc; pointers + timestamps
  + 2-3 load-bearing facts.
- **`scripts/status.ts`** — one-shot dashboard querying in-flight
  registry + `tuning_experiments` open rows + LXC `pgrep` + orchestrator
  `/state`. ~80 lines. Run at session start + before sleep + after
  crash suspicion.
- **5 starting invariants** → blocking preflight. See
  `docs/decisions.md` "Round A + Round B architecture" entry for the
  full list.
- **V2 transport interceptor Phase 2** — retire V1 env flags. Deferred
  pending an equivalence test matrix (seven V1 seams × V2 rule-backed
  equivalents).
- **Codex final flag:** `RESIDUAL_WORK_2` — the organic-run-verify PASS
  is narrow; didn't exercise rewrite/reviser branches. Combined with
  today's forced R-campaigns the architecture is validated, but #239
  alone is narrow. Worth noting for the "what counts as validation"
  discussion in future sessions.

Next session: start by reading `.claude/session-handoff.md`, not this
retrospective. The handoff is the short living state doc; this retro is
point-in-time evidence.
