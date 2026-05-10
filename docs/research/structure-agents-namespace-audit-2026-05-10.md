---
title: structure-* Agents Namespace Audit
date: 2026-05-10
status: audit + non-binding move proposal; docs-only, no code change
---

## Section 1 — Method

This audit verifies the over-build critique O2 claim
(`docs/research/opus-overbuild-critique.md` §O2) that all five `structure-*`
agents under `src/agents/` are imported only by `scripts/corpus/*` and never
fire from a runtime planner / writer / checker path. The audit is a grep +
read pass; nothing is moved, renamed, deleted, or rewired.

I did the following greps, all rooted at the repo root and case-sensitive:

1. **String-name occurrence sweep** for the five agent slugs across `src/`,
   `scripts/`, `tests/`, `ui/`, `sql/`. (The `*.test.ts` colocation under
   `src/` was covered by the `src/` recursive grep.)
2. **Import-form sweep**:
   `from .*structure-(promise|mice|mckee-gap|character-arcs|value-charge)`
   to enumerate all callers.
3. **Named-export sweep** for every named function / constant / schema each
   `index.ts` exports (`extractPromises`, `extractMice`, `extractMckeeGap`,
   `extractCharacterArcs`, `extractValueCharge`, plus their `*_SYSTEM`
   prompt-string consts and `build*Context` / `*Schema` re-exports).
4. **Registration check** — read `src/agents/index.ts` and confirmed which
   agents the barrel exports.
5. **Routing check** — read `src/models/roles.ts` rows that contain
   `structure-` and read the surrounding doc-comment block.
6. **Pipeline-flag check** — `src/config/pipeline.ts` grepped for the same
   strings.
7. **Phases / orchestrator / harness sweep** — `src/phases/`,
   `src/orchestrator/`, `src/harness/` recursive grep for the same strings
   (zero hits).
8. **System-prompt language check** — opened every `*-system.md` /
   `*-system-v2-draft.md` and recorded the first three lines of each.
9. **Runtime-prompt mention check** — searched for the agent slugs inside
   any `.md` under `src/` (excluding the agent's own dir). Zero hits.
10. **Output-consumer check** — searched `src/` for the conceptual output
    types (`PromiseRegistry`, `valueCharge`, `miceThread`, `mckeeGap`) to
    confirm no runtime planner/writer/checker reads any value these agents
    emit. The only hits are the doc-comment in `roles.ts` and the
    `structure-mckee-gap` slug itself.

Importer classification rule: a file under `scripts/corpus/` is "corpus /
script"; a file under `src/phases/`, `src/orchestrator/`, `src/harness/`,
`src/agents/`, `src/lint/`, `src/llm.ts`, or `src/transport.ts` would be
"runtime"; a file under `tests/` or with a `.test.ts` suffix is "test"; a
match in `src/agents/index.ts`, `src/models/roles.ts`, or
`src/config/pipeline.ts` is flagged as registration / routing.

## Section 2 — Per-agent audit

### structure-promise

- **Exports** (from `src/agents/structure-promise/index.ts`):
  `buildPromiseOpenContext`, `buildPromiseCloseContext`,
  `openPromiseListSchema`, `closurePromiseListSchema`,
  `PROMISE_OPEN_SYSTEM`, `PROMISE_CLOSE_SYSTEM`, `extractPromises`,
  plus types `PromiseOpenContextInput`, `PromiseCloseContextInput`,
  `PromiseBeatRow`, `OpenPromise`, `ClosurePromise`, `FullPromise`,
  `PromiseExtractResult`.
- **Registered in `src/agents/index.ts`**: **no.** The barrel
  (`src/agents/index.ts`, full content read) only re-exports
  `worldBuilder`, `characterAgent`, `plotter`, `planningPlotter`,
  `planningBeats`, `planningStateMapper`, `planningStateRepair`, `writer`,
  `continuity`, `chapterPlanChecker`, `functionalStateChecker`. None of the
  five `structure-*` agents are re-exported.
- **Routed via `src/models/roles.ts`**: **yes.** `roles.ts:184` registers
  `"structure-promise"`; `roles.ts:210` `"structure-promise-judge"`;
  `roles.ts:218` `"structure-promise-judge-t0"`; `roles.ts:242`
  `"structure-promise-judge-flash"`; `roles.ts:278`
  `"structure-promise-match"`. The surrounding doc-block at `roles.ts:166`
  reads `// ── Corpus structural extractors (Stage 6 — offline scripts ONLY) ───`
  and at `roles.ts:189` `// ── Stage 6 LLM-judge slots (cross-tier, NOT in the runtime pipeline) ─`.
- **Toggled via `src/config/pipeline.ts`**: **no.** Grep for `structure-promise`
  inside `src/config/pipeline.ts` returns zero hits.
- **Importers**:
  - runtime: 0
  - corpus / script: 2 — `scripts/corpus/extract-structure.ts:31`
    (`import { extractPromises, type FullPromise, type PromiseBeatRow }`)
    and `scripts/corpus/llm-judge.ts:32` (`import { extractPromises, type
    PromiseBeatRow }`).
  - test: 0 (zero matches in `tests/` or under `src/**/*.test.ts`).
- **Prompt content posture**: `promise-open-system.md:1` reads
  `"You read the chapter-by-chapter beat sequence of a published novel and
  identify promises that the author makes to the reader."` and line 3
  declares `"This is a corpus-extraction task."` `promise-close-system.md:1`
  reads `"You are doing the closure pass on a list of promises previously
  identified in a published novel."` Neither prompt is shaped for an
  in-progress novel outline.
- **Conclusion**: **corpus-only.** The agent fires only from
  `scripts/corpus/`; the role registration is intentional infrastructure
  for the offline pipeline.

### structure-mice

- **Exports** (from `src/agents/structure-mice/index.ts`):
  `buildMiceContext`, `miceSchema`, `MICE_SYSTEM`, `extractMice`,
  plus types `MiceContextInput`, `MiceOutput`, `MiceResult`.
- **Registered in `src/agents/index.ts`**: **no.**
- **Routed via `src/models/roles.ts`**: **yes.** `roles.ts:186`
  `"structure-mice"`; `roles.ts:226` `"structure-mice-judge"`; `roles.ts:250`
  `"structure-mice-judge-flash"`. Same doc-block scope ("offline scripts
  ONLY", "NOT in the runtime pipeline").
- **Toggled via `src/config/pipeline.ts`**: **no.**
- **Importers**:
  - runtime: 0
  - corpus / script: 2 — `scripts/corpus/extract-mice.ts:33`
    (`import { extractMice, type MiceOutput }`) and
    `scripts/corpus/llm-judge.ts:33` (`import { extractMice }`).
  - test: 0.
- **Prompt content posture**: `mice-system.md:1` reads
  `"You tag scenes from a published novel with MICE-thread structural
  metadata. This is a corpus-extraction task; your output trains the
  harness's structural-imitation layer..."`. The `mice-system-v2-draft.md`
  exists in the directory but is not loaded by `index.ts` (the constant
  `MICE_SYSTEM` reads `mice-system.md`, line 26-29).
- **Conclusion**: **corpus-only.**

### structure-mckee-gap

- **Exports** (from `src/agents/structure-mckee-gap/index.ts`):
  `buildMckeeGapContext`, `mckeeGapSchema`, `MCKEE_GAP_SYSTEM`,
  `extractMckeeGap`, plus types `McKeeGapContextInput`, `McKeeGapOutput`,
  `McKeeGapResult`.
- **Registered in `src/agents/index.ts`**: **no.**
- **Routed via `src/models/roles.ts`**: **yes.** `roles.ts:187`
  `"structure-mckee-gap"`; `roles.ts:230` `"structure-mckee-gap-judge"`;
  `roles.ts:254` `"structure-mckee-gap-judge-flash"`.
- **Toggled via `src/config/pipeline.ts`**: **no.**
- **Importers**:
  - runtime: 0
  - corpus / script: 2 — `scripts/corpus/extract-mckee-gap.ts:37`
    (`import { extractMckeeGap, type McKeeGapOutput }`) and
    `scripts/corpus/llm-judge.ts:34` (`import { extractMckeeGap }`).
  - test: 0.
- **Prompt content posture**: `mckee-gap-system.md:1` reads
  `"You tag beats from a published novel with McKee Gap structural
  metadata. This is a corpus-extraction task..."`.
- **Conclusion**: **corpus-only.**

### structure-character-arcs

- **Exports** (from `src/agents/structure-character-arcs/index.ts`):
  `buildCharacterArcsContext`, `characterArcsListSchema`,
  `CHARACTER_ARCS_SYSTEM`, `extractCharacterArcs`, plus types
  `CharacterArcsContextInput`, `CharacterArcsBeatRow`, `CharacterArc`,
  `CharacterArcsList`, `CharacterArcsExtractResult`.
- **Registered in `src/agents/index.ts`**: **no.**
- **Routed via `src/models/roles.ts`**: **yes.** `roles.ts:185`
  `"structure-character-arcs"`; `roles.ts:222`
  `"structure-character-arcs-judge"`; `roles.ts:246`
  `"structure-character-arcs-judge-flash"`; plus `roles.ts:287`
  `"structure-character-match"` (a related semantic-name matcher used by
  `compute-calibration.ts`, not the extractor itself).
- **Toggled via `src/config/pipeline.ts`**: **no.**
- **Importers**:
  - runtime: 0
  - corpus / script: 2 — `scripts/corpus/extract-character-arcs.ts:31-33`
    (`import { extractCharacterArcs, ... } from "../../src/agents/structure-character-arcs"`)
    and `scripts/corpus/llm-judge.ts:35` (`import { extractCharacterArcs,
    type CharacterArcsBeatRow }`).
  - test: 0.
- **Prompt content posture**: `character-arcs-system.md:1` reads
  `"You read the chapter-by-chapter beat sequence of a published novel and
  identify the Lie / Truth / Want / Need character arc for each main
  character."` Line 3: `"This is a corpus-extraction task."`
- **Conclusion**: **corpus-only.**

### structure-value-charge

- **Exports** (from `src/agents/structure-value-charge/index.ts`):
  `buildValueChargeContext`, `valueChargeSchema`, `VALUE_CHARGE_SYSTEM`,
  `extractValueCharge`, plus types `ValueChargeContextInput`,
  `ValueChargeOutput`, `ValueChargeResult`.
- **Registered in `src/agents/index.ts`**: **no.**
- **Routed via `src/models/roles.ts`**: **yes.** `roles.ts:183`
  `"structure-value-charge"`; `roles.ts:206` `"structure-value-charge-judge"`;
  `roles.ts:238` `"structure-value-charge-judge-flash"`.
- **Toggled via `src/config/pipeline.ts`**: **no.**
- **Importers**:
  - runtime: 0
  - corpus / script: 2 — `scripts/corpus/extract-structure.ts:30`
    (`import { extractValueCharge, type ValueChargeOutput }`) and
    `scripts/corpus/llm-judge.ts:31` (`import { extractValueCharge }`).
  - test: 0.
- **Prompt content posture**: `value-charge-system.md:1` reads
  `"You tag scenes from a published novel with value-charge structural
  metadata. This is a corpus-extraction task..."`. The
  `value-charge-system-v2-draft.md` is on disk but `index.ts:21-24` only
  reads `value-charge-system.md`.
- **Conclusion**: **corpus-only.**

## Section 3 — Cross-agent summary table

| Agent | Runtime importers | Corpus importers | Registered in `agents/index.ts` | Routed in `roles.ts` | Conclusion |
|---|---|---|---|---|---|
| structure-promise | 0 | 2 (`scripts/corpus/extract-structure.ts`, `scripts/corpus/llm-judge.ts`) | no | yes (5 entries: extractor + 4 judge variants + match) | corpus-only |
| structure-mice | 0 | 2 (`scripts/corpus/extract-mice.ts`, `scripts/corpus/llm-judge.ts`) | no | yes (3 entries: extractor + 2 judge variants) | corpus-only |
| structure-mckee-gap | 0 | 2 (`scripts/corpus/extract-mckee-gap.ts`, `scripts/corpus/llm-judge.ts`) | no | yes (3 entries: extractor + 2 judge variants) | corpus-only |
| structure-character-arcs | 0 | 2 (`scripts/corpus/extract-character-arcs.ts`, `scripts/corpus/llm-judge.ts`) | no | yes (4 entries: extractor + 2 judge variants + character-match) | corpus-only |
| structure-value-charge | 0 | 2 (`scripts/corpus/extract-structure.ts`, `scripts/corpus/llm-judge.ts`) | no | yes (3 entries: extractor + 2 judge variants) | corpus-only |

**O2 verification verdict**: **the over-build critique's O2 claim is
verified.** All five agents have zero runtime importers. The doc-block at
`src/models/roles.ts:166` already says the same thing in code comments
(`Corpus structural extractors (Stage 6 — offline scripts ONLY)` and
`NOT in the runtime drafting pipeline`). The autopsy R12 is consistent
with this audit; the route-to-runtime claim in O2 ("wired into role
routing") is technically correct in the sense that role entries exist, but
the doc-comment surrounding those entries already names them as offline
infrastructure, and `AGENT_MODELS` enumeration is the only "runtime
visibility" they get (via `src/orchestrator/novel-routes.ts:160` which
iterates `Object.keys(AGENT_MODELS)` to populate the agent-override UI
list — but no runtime drafting code path invokes any of these agents).

## Section 4 — Move proposal (non-binding)

All five agents classify as `corpus-only`, so a directory move is the safe
shape. This proposal is non-binding: the operator decides whether to move
or to leave the structure as-is and address the namespace concern with
clearer doc-comments / a section header in `roles.ts`.

### Where they would go

**Proposed target**: `src/agents/corpus-extractors/` (one directory level
nested under `src/agents/`, mirroring R2 in
`docs/research/opus-overbuild-critique.md`).

Rationale for `src/agents/corpus-extractors/` over alternatives:

- **Not** `scripts/corpus/agents/` because the existing
  `scripts/corpus/extract-*.ts` files import from `src/` and stay in
  scripts. Moving the agent dirs into `scripts/` would invert the
  src-vs-scripts boundary and require more import rewrites in the corpus
  scripts.
- **Not** `src/corpus-tools/agents/` because that introduces a brand-new
  top-level directory. `src/agents/corpus-extractors/` is one new
  intermediate directory and reuses the existing top-level `agents/`
  hierarchy, so the `from "../../src/agents/..."` import roots in
  `scripts/corpus/` shift by one path segment only.
- The CLAUDE.md "Source Map" already says
  `Agent prompts/schemas/context: src/agents/{name}/`. Adding a single
  intermediate directory does not violate that convention; it simply
  groups offline tooling agents under a sub-namespace.

The `*-system-v2-draft.md` files (`structure-mice/mice-system-v2-draft.md`
and `structure-value-charge/value-charge-system-v2-draft.md`) move along
with their parent directories as part of the move. The over-build
critique R2 proposes deleting them; this audit defers that to a separate
operator decision (it's a content question, not a namespace question).

### What imports / registrations / role mappings would change

Exhaustive list (the operator can grep against this):

1. **5 agent directories renamed:**
   - `src/agents/structure-promise/` → `src/agents/corpus-extractors/structure-promise/`
   - `src/agents/structure-mice/` → `src/agents/corpus-extractors/structure-mice/`
   - `src/agents/structure-mckee-gap/` → `src/agents/corpus-extractors/structure-mckee-gap/`
   - `src/agents/structure-character-arcs/` → `src/agents/corpus-extractors/structure-character-arcs/`
   - `src/agents/structure-value-charge/` → `src/agents/corpus-extractors/structure-value-charge/`

2. **7 import statements rewritten** (in 5 files):
   - `scripts/corpus/extract-structure.ts:30` —
     `from "../../src/agents/structure-value-charge"` →
     `from "../../src/agents/corpus-extractors/structure-value-charge"`
   - `scripts/corpus/extract-structure.ts:31` —
     `from "../../src/agents/structure-promise"` →
     `from "../../src/agents/corpus-extractors/structure-promise"`
   - `scripts/corpus/extract-mice.ts:33` —
     `from "../../src/agents/structure-mice"` →
     `from "../../src/agents/corpus-extractors/structure-mice"`
   - `scripts/corpus/extract-mckee-gap.ts:37` —
     `from "../../src/agents/structure-mckee-gap"` →
     `from "../../src/agents/corpus-extractors/structure-mckee-gap"`
   - `scripts/corpus/extract-character-arcs.ts:33` —
     `from "../../src/agents/structure-character-arcs"` →
     `from "../../src/agents/corpus-extractors/structure-character-arcs"`
   - `scripts/corpus/llm-judge.ts:31-35` — five imports under one
     contiguous block.

3. **`src/agents/index.ts`**: **unchanged.** None of these agents are
   re-exported there today, so the barrel needs no edit.

4. **`src/models/roles.ts`**: **role keys unchanged.** The keys
   `"structure-promise"`, `"structure-mice"`, `"structure-mckee-gap"`,
   `"structure-character-arcs"`, `"structure-value-charge"` plus their
   `*-judge`, `*-judge-flash`, `*-judge-t0`, `*-match`, `structure-character-match`
   variants are string identifiers, not module paths. Renaming the
   directory does **not** require touching `roles.ts`. (This is a
   meaningful safety property — the role string is decoupled from the
   filesystem location.) Optional doc-comment polish in `roles.ts:166-188`
   to reflect the new dir is a separate edit and not required by the
   move.

5. **`src/config/pipeline.ts`**: **unchanged.**
6. **`src/phases/`, `src/orchestrator/`, `src/harness/`**: **unchanged.**
7. **`tests/` and `*.test.ts`**: **unchanged.** No tests import these
   modules.
8. **`ui/`, `sql/`**: **unchanged.** No references.

### What test coverage protects the move

This is the audit's main finding-of-concern: **no `.test.ts` file imports
any of these five agents.** The corpus pipeline is the only consumer, and
its end-to-end integration test is a manual `bun scripts/corpus/extract-*.ts`
run against the Crystal Shard fixture (per CLAUDE.md "Corpus Pipeline"
memory entry: 2,470 pairs, all invariants pass).

Existing test coverage that *would* catch a botched move:

- `src/models/roles.test.ts:28` iterates `Object.entries(AGENT_MODELS)`. A
  bad rename would leave the `roles.ts` keys unchanged (because role
  strings are decoupled from the dir), so this test does **not** detect a
  filesystem move regression.
- TypeScript compilation (`bunx tsc --noEmit` or `bun run check`) would
  catch broken imports in the seven import statements named in §4.2.
- `bun test` doesn't exercise the structure-* agents directly.

Gap-coverage proposal (still non-binding): add a `scripts/corpus/extract-*.ts`
smoke that invokes each extractor against a tiny fixture (one chapter, one
beat, one scene) and asserts non-error return. This is independent of the
move proposal — the gap exists today regardless.

### Smallest reversible PR shape

Three commits, in this order. Each is independently revertible.

**Commit 1 — `chore: move structure-* agent dirs under corpus-extractors/ (no role/code changes)`**
- `git mv` the five directories.
- Update the seven import statements in `scripts/corpus/`.
- Run `bun run check` (or `bunx tsc --noEmit`) — must pass.
- Run `bun scripts/corpus/extract-structure.ts --novel salvatore_dark_elf
  --book crystal_shard --dim value-charge --limit 1` (or whichever flag set
  matches the actual CLI; check `extract-structure.ts` first) to confirm
  one extractor still calls.
- This commit is the **only** required filesystem change.

**Commit 2 — `docs: roles.ts comment block reflects corpus-extractors/ path`**
- Update the doc-comment at `src/models/roles.ts:166-188` (and the
  comparable Stage-6 LLM-judge block at `:189-205`) to point operators at
  `src/agents/corpus-extractors/` instead of `src/agents/structure-*`.
- No semantic change.

**Commit 3 — `chore: drop structure-mice/mice-system-v2-draft.md and structure-value-charge/value-charge-system-v2-draft.md`** *(optional; defer if operator prefers to keep drafts)*
- Per O2: these are draft-state artifacts not loaded by any `index.ts`.
- A separate commit makes this revertible without affecting the move.

Total scope: **5 dir renames + 7 import updates + a comment-block edit**.
Zero behavioral runtime changes.

### Risks the audit didn't catch

Concretely, what could break:

1. **A non-`.ts` file referencing the old path.** I greped for the slug
   strings inside `*.md` under `src/`, but I did not exhaustively scan
   `docs/`, `output/`, or `state/` for path strings that some script
   might `readFileSync` against (e.g. cached prompts written to disk
   under the old absolute path). Mitigation: a global string-grep before
   the move (`grep -rn "agents/structure-" .` excluding `output/` and
   `node_modules/`) — should return only the files this audit already
   names.
2. **`bun:sqlite` or PG row data** that stores the agent directory path as
   metadata. The schema check is one query: `SELECT DISTINCT agent_name
   FROM llm_calls WHERE agent_name LIKE 'structure-%' LIMIT 5;` — agent
   names in the DB are role strings, not paths, so this should be safe,
   but the operator should confirm.
3. **A script outside `scripts/corpus/` that imports the structure agents
   indirectly** through a shared utility that re-exports them. The
   import-form sweep (§1.2) covers `from .*structure-*` literally; a
   `import * as X from "..."` re-export chain would also be visible to
   that grep, but a deeply transitive path is not. Mitigation: the
   `bunx tsc --noEmit` step will fail loudly on any import path that
   stops resolving.
4. **`docs/charters/corpus-structural-decomposition-v1.md`** and other
   charter / decision docs reference these paths. The move requires an
   accompanying docs sweep (one more `git grep` then a single docs
   commit) to keep references current. Minor risk; flag for the operator.
5. **`AGENT_MODELS` UI surface.** The orchestrator UI iterates
   `Object.keys(AGENT_MODELS)` to render the agent-override list
   (`src/orchestrator/novel-routes.ts:160`). The structure-* role keys
   appear in the override UI today. The move does not change this — the
   keys stay in `roles.ts`. If the operator wants the structure-* keys
   *hidden* from the runtime-override UI, that's a separate UI filter
   change orthogonal to the namespace move.

### Pre-move verification step

In order, before commit 1 lands:

1. `git grep -n "src/agents/structure-" -- ':!docs/'` — confirm every hit
   is in the seven import statements named in §4.2.
2. `git grep -n "agents/structure-" -- 'docs/'` — list doc references for
   the post-move doc-sweep.
3. `bunx tsc --noEmit` — clean baseline.
4. After the move, repeat `bunx tsc --noEmit` — should still be clean.
5. After the move, dry-run one corpus extractor:
   `bun scripts/corpus/extract-mice.ts --help` (or equivalent — check the
   actual CLI surface in `extract-mice.ts` first; the audit didn't
   confirm a `--help` flag).
6. After the move, run the existing Crystal Shard fixture if available:
   per the CLAUDE.md memory `project_corpus_pipeline`, `novels/<key>/`
   has the canonical reference bundle. The operator already runs
   `bun run corpus:extract:smoke` per O2 — same pre-move check.

## Section 5 — Open questions for the operator

1. **Are the `*-judge`, `*-judge-flash`, `*-judge-t0`, `*-match`, and
   `structure-character-match` role entries (11 additional rows in
   `roles.ts`) intentional permanent infrastructure for the offline
   calibration loop, or are some of them concluded-experiment scaffolding
   that could also be retired?** The audit confirms zero runtime use, but
   doesn't distinguish "still actively used by a current corpus
   calibration cohort" from "left over from Phase B / Phase C.3 that
   already concluded." The decision is: should the `roles.ts` cleanup go
   *broader* than the directory move?

2. **Should the `*-system-v2-draft.md` files (mice + value-charge) be
   deleted, kept, or promoted to `*-system.md`?** The over-build critique
   R2 says delete; this audit defers. If they represent in-flight prompt
   work (per memory `project_corpus_pipeline`, the corpus pipeline is the
   reference), the answer might be promote-on-validation rather than
   delete.

3. **Does the orchestrator UI agent-override surface (populated from
   `Object.keys(AGENT_MODELS)`) want a runtime/offline split — i.e. should
   the override UI hide the structure-* + judge + match roles since they
   never fire on a runtime novel run?** This is a UI-visibility question
   independent of the namespace move; flagging it here because the move
   doesn't address it and the operator may want to bundle.

4. **Is there a near-term plan to promote any of the structure-* agents
   from corpus-extraction-shaped to planner-shaped (i.e.
   `opus-harness-autopsy.md` R5's "Promote one structure agent
   (Promise/Payoff) from corpus-extractor to live planner constraint")?**
   Per push-back P8 in `opus-overbuild-critique.md`, R5 is being
   over-rejected — but if R5 *is* on the table for the lane queue, a
   directory move now is wasted motion (the planner-shaped variant would
   want a planner-shaped name like `planning-promise`, not
   `corpus-extractors/structure-promise`). The move should wait until the
   user-adjusted backlog (`docs/research/user-adjusted-backlog-2026-05-10.md`)
   resolves whether scene-level lane B5 promotes anything that touches
   PromiseRegistry.

5. **Should the audit lead to a `roles.ts` section comment that names
   "offline / corpus" as a first-class category, separate from "runtime"
   roles, instead of (or in addition to) the namespace move?** The
   doc-block at `roles.ts:166` already says
   `// ── Corpus structural extractors (Stage 6 — offline scripts ONLY) ───`
   — strengthening that comment with a one-line warning ("nothing in
   `src/phases/`, `src/orchestrator/`, `src/harness/` should ever route
   to a key in this section") might give 80% of the namespace-move
   benefit at 5% of the diff cost.
