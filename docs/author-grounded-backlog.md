# Novel Harness — Author-Grounded Backlog

Research-backed backlog for improving visibility, interactivity, and plan-to-prose adherence in the novel creation pipeline. Each recommendation is anchored to working novelists, professional editors, and craft teachers; sources are cited inline.

**Source pool:** Sanderson (BYU 2025), K.M. Weiland (Helping Writers Become Authors), Donald Maass, John Truby, Robert McKee, James Scott Bell, Shawn Coyne (Story Grid), Gwen Hayes (Romancing the Beat), Renni Browne & Dave King, Robin Hobb interviews, Patrick Rothfuss process, Andrew Rowe, Royal Road LitRPG community, Aeon Timeline / Plottr / World Anvil tooling docs.

---

## Repo principle add: UI Work Gate

Any UI-facing feature or fix must be browser-tested with Playwright MCP before handoff, with screenshot/evidence captured. Code inspection and unit tests are not enough for UI clearance.

- Add a **UI Work Gate** section to `CLAUDE.md` under "Development Workflow."
- Create `docs/ui-work-gate.md` naming the minimum evidence: golden-path screenshot, one edge case, one regression check on adjacent surfaces. Lane-queue handoff requires evidence linked.
- The implementation reference (`docs/how-to/playwright-mcp-browser-testing.md`) already exists. The gap is making it a documented gate, not a one-off preflight.
- Optional later: `scripts/playwright-preflight.ts` driving a saved scenario set from the queue.

## Repo principle add: Creative Heuristic Eval Gate

Any craft heuristic that changes planner, writer, or checker behavior must
first run as diagnostic-only or A/B-gated work. Source strength is not enough
to wire a heuristic into production defaults.

- Declare a baseline, one changed lever, sample shape, budget, measurable
  signal, stop gate, and promotion/rollback criteria before runtime wiring.
- Candidate heuristics include promise/story-debt influence, scene turns,
  micro-tension, character agency, world-detail forcing, genre strictness, and
  voice/motivation nudges.
- Character voice and motivation polish remains important, but should follow
  context engineering, deterministic flow, and operator interactivity.
- Detailed first-step plan: `docs/authoring-harness-refinement-plan.md`.

---

## How author practice changes prior assumptions

Five places where craft literature overrides earlier internal leanings:

| Topic | Prior lean | Author-source correction |
|---|---|---|
| **Phase order** | "Hybrid; phases navigable" | Confirmed — but stronger: linearity is contrary to *every* major craft source. Make non-linearity a hard principle. |
| **Operational world rules** | "Wire `world_systems.constraints_json` into beat context + violation checker" | Too broad. Sanderson's First Law constrains enforcement to **conflict-resolving rules already established in earlier prose**. Tag world facts by role: `operational`, `reference`, `hidden`. |
| **Plot adherence retry** | "Retry-to-conform with `maxBeatRetries=2`" | Correct for **obligatory** beats only. For flexible beats, after N retries the pro move is to **revise the outline**, not keep forcing prose. Add escalate-to-replan as a first-class proposal kind. |
| **Scene-level continuity** | "Continuity at chapter granularity is fine; scene-level overkill" | Confirmed for *cross-cutting* state (location, knowledge). But scene-internal fields (goal/conflict/outcome, value polarity) are explicitly scene-level in Story Grid + Bell + McKee. Add scene-internal; skip scene cross-cutting. |
| **Character bible fields** | "9 current fields are adequate; add knowledge graph" | Insufficient. Weiland's Lie/Want/Need/Ghost/Truth and Sanderson's Likeability/Competence/Proactivity sliders are arc-driving and absent. Speech-pattern needs to be structured, not free-text. |

---

## Findings most strongly supported by source

### Finding 1 — Promise/Progress/Payoff is the missing plot primitive

Sanderson's 2025 Lecture #2 frames Promise/Progress/Payoff as *the* foundation of plot — not a heuristic, the core schema.[^29][^30] Aeon Timeline is widely adopted specifically because manual tracking of payoff debts at novel length exceeds working memory.[^31] The harness has plot adherence (was the beat written?) but **no payoff ledger** (was the promise paid?).

**Backlog item:** start with a planner-owned story-debt artifact, not a global
Canon-like substrate. Track promises opened, expected progress beats, intended
payoff zone, current status, and ignored-debt warnings. Feed it through planner
and beat-writer context only in an A/B-gated experiment; add durable schema only
if evidence shows better structure, payoff continuity, or lower operator edit
burden.

### Finding 2 — The "on-plot but flat" gap has four named causes

Maass on micro-tension, Bell on Goal/Conflict/Disaster, McKee on value-charge turns, Truby on moral argument — these four converge as *the* answer to "plot delivered but scene doesn't work."[^18][^19][^20][^6] This is the most-cited single answer in craft literature to a question the harness implicitly asks.

**Backlog item:** evaluate these as *diagnostic-only* or A/B-gated candidates
before production wiring:

- **Value-charge turn** — does the scene's named value flip polarity (open → close)? Binary, checkable.
- **Micro-tension** — per-page detection of disagreement / anxiety / conflict. Operationalizable per Maass: "In dialogue, tension means disagreement; in action, inner anxiety of the POV character; in exposition, ideas in conflict and emotions at war."[^18]
- **Scene shape** — Goal, Conflict, Disaster present? Missing any → flag.
- **Moral-argument advance** — did the chapter touch protagonist's Lie/Truth?

These fit the existing diagnostic-only validation phase and the
demoted-to-warning posture for hallucination-ungrounded already in the project
memory, but they should not become blockers or default prompt pressure until
experiments prove value.

### Finding 3 — Genre dictates strictness, and the *kind* of strictness varies by genre

Romance has 19–20 named obligatory beats (Hayes); LitRPG's defining contract is system/numerical consistency (Royal Road consensus, Andrew Rowe); pulp is per-quarter pacing (Dent); fantasy is most permissive on beats but strict on whatever magic rules the author committed to.[^23][^24][^25][^26][^27]

Hayes: "the romance arc is made up of its own story beats, and the external plot and theme need to be braided to the romance arc — not the other way around."[^23]

Rowe on progression fantasy: "establish a ceiling early," manage level granularity, avoid power creep, "make a plan before tackling the genre to avoid having to bend the rules you've established."[^27]

**Backlog item:** Per-genre adherence configuration.

- For romance: hard-encode Hayes 20-beat list as obligatory.
- For LitRPG: invest in stat continuity + level-vs-difficulty + no-MC-exception checks (these are the genre's reader contract).
- For pulp: per-quarter action density (Dent four-quarter structure).
- For fantasy: relax beat strictness; tighten Sanderson-Laws magic enforcement.

Aligns with the existing genre-flexibility direction in project memory.

### Finding 4 — Character bibles are unanimously living documents

Hobb, Rothfuss, Sanderson all explicitly update characters mid-draft.[^4][^17][^1] No professional source advocates set-and-freeze. Hobb on the Fool: meant to be "a very minor character" but "some characters just have their own ideas about the story."[^4] Rothfuss has dismantled and reassembled book three multiple times.[^17]

The harness's proposal workflow already supports mid-draft edits. The gap is **UX prominence**.

**Backlog item:** Surface character editing inside the drafting view, not buried in a planning tab. Per-chapter character state (which already exists in `character_states` schema) needs UI surfacing. High-value, low-cost.

### Finding 5 — Add Lie/Want/Need/Ghost/Truth + Sanderson sliders

Weiland's Creating Character Arcs frames every character's arc as Lie believed → Want (false goal) → Need (true goal) → Ghost (backstory wound) → Truth.[^5] Sanderson's three sliders (Likeability / Competence / Proactivity) drive perceived arc movement when their values change across chapters: "Most characters will start with one or two categories high and one or two categories low."[^7][^8] Both are absent from the current schema; both are arc-determining.

**Backlog item:** Extend character schema with these named fields. Make sliders per-chapter values so the UI can plot a slider line across the novel. The existing `character_states` schema already supports per-chapter values — these are new fields in that table.

---

## Findings with mixed/conditional support

### Finding 6 — Operational world rules are conditional, not universal

Sanderson's First Law: "An author's ability to solve conflict with magic is DIRECTLY PROPORTIONAL to how well the reader understands said magic."[^12] Critically: enforcement applies to rules that **resolve plot conflict** AND have been **established in prior prose**. World Anvil and Campfire — the two leading commercial world-building tools — both treat lore as searchable reference, not a constraint engine.[^14]

**Backlog item (revised from earlier internal lean):**

- Tag world facts with `role: operational | reference | hidden`.
- Track whether an `operational` fact has been **established** in prior prose (a "first appearance" chapter pointer).
- Checker enforcement applies only to `operational + established` facts. Reference facts surface in beat context but don't generate violations.
- Add explicit `limits` and `costs` fields to magic/economy/political systems (Sanderson Second Law: Limitations > Powers).

Avoids drowning the operator in violations from incidental world details.

### Finding 7 — Scene-internal fields yes, scene cross-cutting no

Story Grid, Bell, McKee all operate at scene granularity for *what scenes do internally* (goal, conflict, outcome, value turn).[^16][^19][^20] McKee: "If the value-charged condition stays unchanged, nothing meaningful happens. The scene has activity… but nothing changes in value. It is a non-event."[^20]

Editorial practice (beta readers, developmental editors, Browne/King checklists) operates at scene-level for **micro-feedback** but reconciles **cross-cutting state** at chapter or book level.[^21][^22]

**Backlog item:**

- **Add scene-internal fields**: `scene_goal`, `scene_conflict`, `scene_outcome`, `value_polarity_open`, `value_polarity_close`.
- **Don't add scene-level character_state, location, knowledge_propagation.** Keep these chapter-level. Storage and proposal-volume cost is real and the editorial practice does not justify it.

### Finding 8 — Editorial practice is multi-alternative + per-pass

Developmental editors deliberately offer multiple alternative directions per issue rather than single prescriptive fixes.[^28] They run separate passes per dimension (tension pass, POV pass, dialogue pass) — not one omnibus check. Browne/King structure their entire book this way.[^22]

**Backlog item:**

- Proposal envelopes optionally carry 2–3 alternatives per issue, not one. UI surfaces them as choices.
- Validation diagnostics gain a **per-pass mode**: operator can run "tension pass only," "value-turn pass only," etc.
- Add **editorial-letter-style per-chapter summary** distinct from inline proposals — a digest of what the diagnostic passes found, written narratively. Roughly 200–500 words per chapter.

---

## Three traps to avoid

1. **Don't enforce phase order.** Even Sanderson, the canonical outliner, says the outline is a living thing.[^1] Any UI affordance that hard-locks `concept → planning → drafting → validation` is contrary to all major craft sources.

2. **Don't universalize world-rule enforcement.** Sanderson's First Law is more constrained than commonly quoted. Enforce hard-magic conflict-resolving rules; treat the rest as reference. The trap: building a checker that fires on every world detail and drowns the operator.

3. **Don't keep retrying prose against an outline that's wrong.** Pros revise the outline. Add escalate-to-replan as a first-class proposal kind for flexible (non-obligatory) beats.

---

## Backlog (product-phase, ranked by source strength)

Each item shows source-strength score (★1–5) and brief reasoning.

### Phase A — Plan primitives (highest source support)

1. **Planner-owned Promise/Progress/Payoff story debt artifact** — ★★★★★ — Sanderson 2025 + Aeon Timeline adoption, but A/B-gated before durable schema. Start in planner/outline data, pass into beat planning/drafting, and promote to DB/UI only after evidence.
2. **Lie/Want/Need/Ghost/Truth + Sanderson sliders on characters** — ★★★★★ — Weiland + Sanderson. Extend `character_states` with these fields; UI slider plot across chapters. `src/db/world.ts:42` (`EDITABLE_CHARACTER_FIELDS`), schema migration.
3. **Genre config layer + per-genre obligatory-beat lists** — ★★★★★ — Hayes (romance), Dent (pulp), Royal Road consensus + Rowe (LitRPG). Add `novels.genre` + `genre_obligatory_beats` table. Romance ships with Hayes 20 beats hard-encoded. Touches `src/config/pipeline.ts`, planner agents.

### Phase B — Plan-to-prose visibility (high source support)

4. **Validation diagnostic checks: value-turn, micro-tension, scene-shape, moral-argument** — ★★★★ — McKee + Maass + Bell + Truby converge. Keep diagnostic/A-B only until value is proven; then surface in per-chapter editorial-letter summary.
5. **Plan→prose traceability UI** — ★★★★ — implied by every developmental-editor source. Failed adherence/diagnostic check links back to originating plan artifact (beat obligation, character state, world rule). Touches canon-proposal routes + `CanonProposalsPage.tsx`.
6. **Editorial-letter per-chapter digest** — ★★★★ — Browne/King + developmental-edit standard practice. New UI surface; ~200–500 words narrative per chapter from existing diagnostic outputs. Touches validation phase output formatting.

### Phase C — Bible richness (mixed-but-strong support)

7. **Surface character bible editing inside drafting view** — ★★★★ — Hobb, Rothfuss, Sanderson all update mid-draft. Move character editing from planning tab into the drafting workspace. UI-only change.
8. **World-fact role tagging (`operational | reference | hidden`) + established-in-prose tracking** — ★★★★ — Sanderson First Law (carefully read). Schema migration on world tables; checker reads role+established before firing. `sql/`, `src/agents/writer/beat-context.ts`.
9. **Structured speech-pattern object on characters** — ★★★ — Hobb on character voice ("vocabulary, how characters see things, attitude, sentence structure, slang, and cadence all make a difference"[^4]). Replace `speechPattern` free-text with `{vocabulary_register, sentence_length_bias, idiolect_markers, avoid_words, cadence_notes}`. Schema + writer prompt updates.
10. **Truby web view** — ★★★ — Truby's character web. UI matrix of character weakness/need/values/moral-stance vs. protagonist. Reference view, no constraint enforcement. UI-only.

### Phase D — Scene primitives (conditional support)

11. **Scene-internal fields: goal/conflict/outcome/value-polarity** — ★★★★ — Story Grid + Bell + McKee. Treat as an experiment first; do not split chapters into durable `scenes` tables until beat-level diagnostics prove the added structure improves output.
12. **Escalate-to-replan proposal kind** — ★★★ — Sanderson + Rothfuss revision practice. After N retries on a flexible (non-obligatory) beat, raise a "revise outline" proposal instead of continuing to retry. Touches `src/phases/drafting.ts` retry logic + new proposal kind.

### Phase E — Review UX (clear-but-incremental)

13. **Multiple alternatives per proposal** — ★★★ — developmental-editor practice. Proposal envelope optionally carries 2–3 suggestions; UI surfaces as choices. Schema field + UI change.
14. **Per-pass diagnostic mode** — ★★★ — developmental-editor practice. Operator runs "tension pass only," etc. UI control + validation-phase parameterization.
15. **Side-by-side diff for artifact patches** — ★★ — implied by editorial practice but not directly cited. Pure UX improvement on existing proposals page.

### Phase F — Repo principle

16. **UI Work Gate (Playwright) added to `CLAUDE.md` + `docs/ui-work-gate.md`** — process add, not author-research-driven. Existing `docs/how-to/playwright-mcp-browser-testing.md` becomes the implementation reference.

---

## Sequencing rationale

The five-star items (1, 2, 3) are foundation candidates, but source strength is
not production evidence. The immediate foundation is deterministic visibility
and interactivity: durable IDs, target maps, impact preview, proposal-backed
planning edits, and Playwright-gated UI.

Phase B items (4–6) deliver the "on-plot-but-flat" diagnosis named as a core
gap, but diagnostic/checker behavior should be promoted only after A/B evidence.

Phase C items (7–10) are mostly editing UX and can ship in parallel once Phase A schema is in place.

Phase D scene primitives (11) are the largest schema change and should follow once the value of scene-internal fields is proven by the diagnostic checks (4) needing them.

Phase E proposal-UX upgrades are independent and can interleave anywhere.

The Playwright gate (16) ships alongside any UI work in any phase.

---

## Open questions for product judgment

These are decision points where the craft literature does **not** give a clean answer and need user input:

- **Promise debt: hard fail or soft warn?** Sanderson says payoff is foundation but doesn't prescribe enforcement strictness. Default to warn; promote to fail per-novel?
- **Genre detection: declared or inferred?** Romance/LitRPG configs depend on knowing genre. Recommend declared.
- **Editorial-letter generation: deterministic from check output, or LLM-formatted?** A deterministic template is auditable; an LLM-formatted letter reads better. Recommend deterministic-template + LLM-polish pass clearly marked.
- **UI Work Gate scope:** net-new UI only, or non-trivial UI edits also? Recommendation: any UI handoff with visible change requires Playwright evidence; "non-trivial" is operator judgment with audit trail.

---

## Sources

[^1]: [Sanderson 2025 BYU Lecture #1 — Philosophy of Professional Writing](https://www.brandonsanderson.com/blogs/blog/brandon-sandersons-writing-class-2025-week-1)
[^4]: [Robin Hobb interview — Fantasy Faction](https://fantasy-faction.com/2013/robin-hobb-interview); [Writing Excuses 11.Bonus-01: Characterization with Robin Hobb](https://wetranscripts.livejournal.com/121439.html)
[^5]: [100+ Questions to Help You Interview Your Character — K.M. Weiland](https://www.helpingwritersbecomeauthors.com/interviewing-your-characters/)
[^6]: [Anatomy of Story — John Truby](https://truby.com/using-the-anatomy-of-story-to-write-your-novel/)
[^7]: [Sanderson's Character Scales — September C. Fawkes](https://www.septembercfawkes.com/2021/04/sandersons-character-scales.html)
[^8]: [Sanderson 2025 Lecture #5 — Proactive, Relatable, Capable Characters](https://www.brandonsanderson.com/blogs/blog/creating-proactive-relatable-and-capable-characters-brandon-sandersons-writing-lecture-5-2025)
[^12]: [Sanderson's First Law — Brandon Sanderson](https://www.brandonsanderson.com/blogs/blog/sandersons-first-law)
[^14]: [Campfire vs World Anvil — Kindlepreneur](https://kindlepreneur.com/campfire-vs-world-anvil/)
[^16]: [Story Grid — Shawn Coyne](https://storygrid.com/)
[^17]: [Patrick Rothfuss has dismantled The Doors of Stone — Winter is Coming](https://winteriscoming.net/2021/04/03/kingkiller-author-patrick-rothfuss-dismantled-big-piece-the-doors-of-stone/)
[^18]: [Maass micro-tension review — The Blue Garret](https://www.thebluegarret.com/blog/writing-the-breakout-novel-maas-review)
[^19]: [Goal-Conflict-Disaster scene structure (Bell)](https://writersdigestonline.com/scene-building/)
[^20]: [Do Your Scenes Turn? — McKee Seminars](https://mckeestory.com/do-your-scenes-turn/)
[^21]: [Editing phases — Savannah Gilbo](https://www.savannahgilbo.com/blog/editing-phases)
[^22]: [Self-Editing for Fiction Writers — Browne/King review](https://www.thebluegarret.com/blog/self-editing-for-fiction-writers-browne-king-review)
[^23]: [Romancing the Beat — Gwen Hayes (First Draft Pro guide)](https://www.firstdraftpro.com/blog/gwen-hayes-romancing-the-beat)
[^24]: [Romancing the Beat — Plottr template](https://plottr.com/romancing-the-beat-template/)
[^25]: [Lester Dent Pulp Fiction Plot Formula — original](https://myweb.uiowa.edu/jwolcott/Doc/pulp_plot.htm)
[^26]: [What makes a good LitRPG — Royal Road](https://www.royalroad.com/forums/thread/97990); [How much do LitRPG readers care about rules — Royal Road](https://www.royalroad.com/forums/thread/104991)
[^27]: [Writing Progression Fantasy — Andrew Rowe](https://andrewkrowe.wordpress.com/2019/03/02/writing-progression-fantasy/)
[^28]: [What to Expect During a Developmental Edit — Dakota Nyght](https://dakotanyght.com/blog/what-to-expect-with-a-developmental-edit); [Developmental Edit walkthrough — Carolina von Kampen](https://carolinavonkampen.com/developmental-edit-for-a-novel/)
[^29]: [Sanderson 2025 Guide to Plot — Lecture #2](https://www.brandonsanderson.com/blogs/blog/brandon-sandersons-2025-guide-to-plot-lecture-2)
[^30]: [Promise, Progress, Payoff — September C. Fawkes](https://www.septembercfawkes.com/2024/10/promise-progress-payoff-in-stories-acts.html)
[^31]: [Aeon Timeline](https://www.aeontimeline.com/); [Aeon Timeline Narrative View](https://www.aeontimeline.com/features/narrative-storytelling)
