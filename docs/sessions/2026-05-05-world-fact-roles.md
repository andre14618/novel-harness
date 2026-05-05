---
status: active
updated: 2026-05-05
role: lane-doc
---

# World Fact Roles — Additive Schema Slice — 2026-05-05

## Loop Contract

- **Objective:** Add `role: 'operational' | 'reference' | 'hidden'` to the `facts` table and `Fact` interface, with `saveFact` accepting role optionally and defaulting to `operational` at the DB layer. Persist + round-trip the column. Do *not* change any agent prompt, checker, writer-context assembly, or fact-extraction behavior. Pure additive structural slice that establishes the column for follow-up scoped-context and scoped-check work.
- **Starting commit:** `6eab44d`
- **Experiment ID:** 477.
- **Budget cap:** $0 (no LLM calls, local DB only).
- **Primary lane:** Richness Backlog — World fact roles. New lane parallel to (and disjoint from) Authoring Visibility/Interactivity which has hit its scope ceiling.
- **Causal hypothesis:** The continuity-state/warning gray zone (decision L81: 20% TP, 40% FP, 40% AMB) and broader writer/checker noise are downstream of every fact getting uniform treatment. Tagging facts by role lets future slices (a) drop `hidden` from writer prompts and (b) demote `reference` from continuity enforcement, eliminating gray-zone cases at their source instead of calibrating a noisy LLM checker. This slice does not yet move the lever — it adds the column the lever will use.
- **Baseline:** No `role` dimension exists. `facts.category` (physical/rule/knowledge/etc.) tags shape, not enforcement role.
- **Changed runtime lever:** None. The new column is persisted but no consumer reads it yet. Default `operational` keeps current behavior bit-identical.
- **Feedback signal:** Migration applies cleanly; `Fact.role` type-checks; round-trip test passes; existing fact callers continue to compile and run.
- **Stop gate:** (a) Clean pass — see below.
- **Escalation rule:** N/A (no runtime change).
- **Allowed parallel support work:** Doc sweep; updating refinement plan to mark the role item in flight.
- **Files expected to change:** `sql/049_world_fact_roles.sql` (new), `src/types.ts`, `src/db/facts.ts`, `src/db/facts.test.ts` (new or extended), `package.json` (no — script not needed), `docs/sessions/lane-queue.md`, `docs/authoring-harness-refinement-plan.md`.
- **Evidence artifact:** Round-trip test + a one-line verification SQL output showing the column exists with the expected default.
- **Out of scope (explicit):** `canon_facts.role` (follow-up slice), agent-prompt changes for fact extraction, writer-context filtering by role, checker-policy changes for reference/hidden facts. Those are separate lane slices that consume the column once it exists.

## Stop Gates

- **(a) Clean pass:** `bun run migrate` applies `sql/049` without error; `bunx tsc --noEmit` clean; round-trip test green; the fast tier for the touched DB module is green; lane-queue + refinement plan updated.
- **(b) New dominant blocker:** A runtime consumer of `Fact` requires more than the additive column (e.g., needs role at construction). Pause and rescope.
- **(c) Regression:** Any fact-related test breaks. Pause.
- **(d) Infrastructure failure:** Migration fails on local Postgres. Pause.
- **(e) Cost cap:** N/A (≈$0).

## Command Plan

- Sample shape: 1 (one DB) — round-trip test on a local fact insert/read.
- Verification:
  - `bun -e "import { migrate } from './src/db/connection'; await migrate(); process.exit(0)"`
  - `bunx tsc --noEmit`
  - `bun test src/db/facts.test.ts`
  - SQL probe: `SELECT role, COUNT(*) FROM facts GROUP BY 1`

## Results

- Outcome: shipped. `sql/049_world_fact_roles.sql` applied (1831 existing rows defaulted to `operational`); `Fact` interface gains `role: FactRole`; `FactInput` allows callers to omit role; `saveFact`/`getFactsUpToChapter`/`getFactsForChapter` round-trip role; 3 fixture sites in test files filled with `role: "operational"` (additive at runtime).
- Stop gate fired: (a) clean pass — migration applied, `bunx tsc --noEmit` clean, `bun test src/db/facts.test.ts` 3/3 green, lane-queue + refinement plan + current-state updated.
- Evidence: round-trip test green; `SELECT role, COUNT(*) FROM facts GROUP BY 1` returns one row `{operational: 1831}`.
- Cost: $0.
- Commits: pending — captured in this session.
- Review: self-reviewed against L79 (eval-gates posture — no runtime change in this slice) and the refinement plan's Richness Backlog (`docs/authoring-harness-refinement-plan.md:496`). Out-of-scope items (`canon_facts.role`, agent-prompt changes, writer-context filtering, checker policy) explicitly deferred to follow-up slices in this same lane.
