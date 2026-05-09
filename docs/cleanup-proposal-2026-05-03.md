---
status: proposal
date: 2026-05-03
owner: andre
stage: phase-1-catalog (read-only)
gated-on: docs/charters/world-bible-architecture.md §0a engineering lane landing
---

# Repo Cleanup Proposal — 2026-05-03

Phase-1 read-only cleanup catalog. Categorizes untracked clutter, retired-subsystem code, and stale docs. **Nothing in this proposal has been moved or deleted yet, except the items noted inline below.** Execution waits on the world-bible §0a engineering lane.

**2026-05-09 partial execution** — independent of §0a, two root-hygiene items were resolved:
- `program.md` archived to `docs/archive/program.md` (see `## Other`).
- 73 loose Playwright UI Work-Gate evidence captures (`artifact-*.png`, `canon-*.png`, `login-snapshot.md`, `planning-studio-*`, `planning-modified-*`) relocated to `.playwright-mcp/evidence/<date>-<surface>/` per-session subfolders. All were already gitignored; this is disk-organization only. Canonical evidence storage for new captures remains `output/playwright/<YYYY-MM-DD>/<surface>-<slug>/` per `docs/how-to/playwright-mcp-browser-testing.md`.

## Summary

- **8 untracked files at repo root** (~978 KB) → all `safe-delete` once the active checker-quality audit work concludes; explicitly documented as regenerable in their parent audit docs.
- **9 historical-superseded result/plan docs** (~140 KB) already marked `> HISTORICAL — superseded.` and catalogued in `current-state.md` §5 — `archive-move` candidates, not delete.
- **Several retired src/ subsystems** (writer-LoRA route, Salvatore-leak detection, Howard primer, voice-shaping ablation, conditioning-floor) have no live runtime imports but most have script/test references and decisions-row provenance — split into `archive-move` (scripts) and `keep-load-bearing` (small src code-comment refs that still anchor decisions).
- **`src/db/embed.ts` + `src/db/retrieval.ts` + `src/agents/writer/context.ts` retrieval branch** are flagged `embeddings: false` but the world-bible charter explicitly says "remains idle under this charter" → `needs-§0a-first`.
- **No SQL migrations proposed for deletion** — migrations are by-policy historical even when the table is gone.
- **All session docs in repo are 2026-04-19 or later** — every session doc is post-cutoff, so the entire `docs/sessions/` tree is hands-off.

Estimated reclaimable disk: ~1.2 MB at root + ~140 KB superseded docs + ~180 KB retired-script archives (rough). Most reclaim is operational clarity, not bytes.

## Untracked at repo root

These eight files are produced by the in-flight checker-quality audit (`docs/checker-quality-audit-2026-05-03*.md`) and the world-bible §0e cost probe. The two audit docs explicitly state these artifacts are **not committed** and should be **regenerated** for an independent replication.

| path | category | justification |
|---|---|---|
| `/Users/andre/Desktop/personal_projects/novel-harness/adh-func-samples.json` (94 KB) | safe-delete | Audit doc: "not in git, regenerate per Replication Guide." Already cited as `/tmp` regenerable. |
| `/Users/andre/Desktop/personal_projects/novel-harness/halluc-fp-sample.json` (19 KB) | safe-delete | Same audit doc clause; replication guide tells operators to re-pull rather than reuse. |
| `/Users/andre/Desktop/personal_projects/novel-harness/checker-fp-samples.json` (29 KB) | safe-delete | Same audit doc clause. |
| `/Users/andre/Desktop/personal_projects/novel-harness/chapter-plan-checker-fp-sample.json` (593 KB) | safe-delete | CPC audit explicitly: "Sample artifact... in repo root (not committed)." |
| `/Users/andre/Desktop/personal_projects/novel-harness/cpc-grading-input.json` (88 KB) | safe-delete | CPC audit input; same regenerable-via-`scripts/_q-cpc.ts` provenance. |
| `/Users/andre/Desktop/personal_projects/novel-harness/cpc-grading-rich.json` (164 KB) | safe-delete | CPC audit output; rich form of the same data, regenerable. |
| `/Users/andre/Desktop/personal_projects/novel-harness/scripts/_cpc-rubric-replay.ts` (14 KB) | keep-load-bearing | Cited at `docs/checker-quality-audit-2026-05-03-chapter-plan-checker.md:139` as the replication script for the K=3 audit. Underscore-prefixed convention says throwaway, but the load-bearing audit doc names it. **Move to a stable location (e.g. `scripts/audits/cpc-rubric-replay.ts`) and update the doc citation, OR keep in place. Do not delete without first promoting the audit-doc citation.** |
| `/Users/andre/Desktop/personal_projects/novel-harness/scripts/_q-cpc.ts` (769 B) | keep-load-bearing | Cited at `docs/checker-quality-audit-2026-05-03-chapter-plan-checker.md:50, 203, 220` as the CPC FP-sample pull script. Same disposition: promote to a stable name and update the four audit-doc citations, do not silently delete. |

**Note on `scripts/_step0e-cost-probe.ts` (8.4 KB) — TRACKED in git.** Cited from `docs/sessions/2026-05-03-world-bible-architecture-step-0.md` and `docs/sessions/2026-05-03-step-0e-cost-probe-results.md`, both load-bearing world-bible §0 evidence. `keep-load-bearing` (already tracked, but flagging for the same "rename out of underscore-prefix" treatment as the CPC scripts above).

## Generated artifacts in tracked paths

None found. `output/`, `finetune-data/`, `scripts/lora-data/`, `wandb/`, `__pycache__/`, `*.pyc`, `node_modules/`, `dist/`, `state/` are all already gitignored. The corpus structural-decomposition exclusions in `.gitignore` (`novels/*/structure/*/*.jsonl`) cover the bulk regenerable extractor output. No stray generated artifacts spotted in tracked paths during this audit.

## Retired src/ subsystems

CLAUDE.md and `docs/current-state.md` "Retired Or Rejected Methodologies" call out these surfaces as retired. Each was audited for reverse dependencies in `src/` and `scripts/`.

| path | category | justification | reverse-dep notes |
|---|---|---|---|
| `src/db/embed.ts` | needs-§0a-first | Embeddings step is `embeddings: false` in `src/config/pipeline.ts:28`. World-bible charter: "the pgvector + RRF code at `src/db/retrieval.ts` remains idle under this charter — for single-book scope, vector retrieval is not the right primary mechanism for runtime canon quality." §0a builds the deterministic bundle assembler; only afterward will we know whether retrieval gets a permanent role in §4 polish/macro pass. | Imported by `src/harness/embeddings.ts` (also idle), `src/harness/novels.ts` (idle status query), `src/db/retrieval.ts`. |
| `src/db/retrieval.ts` | needs-§0a-first | Same charter clause. Idle but explicitly named in §0a context. | Imported by `src/agents/writer/context.ts` (the dynamic-retrieval branch behind `hasEmbeddings(novelId)` guard) and `src/harness/graph.ts`. The writer-context retrieval branch is dead-code-by-flag, but §0a will rewrite this assembler. Don't pre-empt. |
| `src/harness/embeddings.ts` | needs-§0a-first | Idle helper module. Same clause. | No callers tracked except `src/orchestrator/api-novel.ts`-class control planes (verify before delete). |
| `src/agents/writer/voice-shaping-prompts.ts` | keep-load-bearing | Charter `voice-shaping-ablation-v1.md` is `status: complete`. Module not imported by any runtime writer code. **However**, `decisions.md` has a long lineage row pointing here, and the file's header comment cites `scripts/evals/run-voice-shaping-ablation.ts` (also retired). | `grep -l voice-shaping-prompts src/` returns 0 hits. Tag as candidate `archive-move` to a `src/_retired/` if the team wants — but I'd rather flag as keep until §0a settles, because L2 layer in the charter still has a "writer system prompt + style/genre primer (e.g., Salvatore voice)" line that may want the prompts module as reference material. |
| `src/agents/writer/example-line-subset.ts` | keep-load-bearing | Conditioning-floor charter is `concluded-kill`. Module's header cites `scripts/evals/run-salvatore-distinctness-v1.ts`. | `grep -l example-line-subset src/` returns `src/agents/writer/beat-context.ts` and `beat-context.test.ts`. Still imported by live writer context — **load-bearing despite charter kill**. Do not move. |
| `scripts/agent/lane-runner.ts` (+ tests) | keep-load-bearing | CLAUDE.md is explicit: "retired as the default engineering control plane and remains legacy/optional for headless one-shot experiments only." `package.json` retains the `lane-runner-legacy` alias. `docs/agent-lane-protocol.md` documents legacy invocation patterns. | Tests + `open-claude-captain.test.ts` assert lane-runner retirement — must stay. |
| `scripts/finetune/extract-howard-primer.ts` | archive-move | Howard primer is **explicitly retired** per CLAUDE.md ("Strategic Constraints") and feedback memory `feedback_style_primer_salvatore_only`. No live `src/` import. | `grep -l howard-primer src/` returns 0 in src; only `decisions.md` history. Move to `scripts/archive/` (or new `scripts/_retired/finetune/`). |
| `scripts/finetune/extract-salvatore-primer.ts` | archive-move | Salvatore voice-LoRA writer route was retired in exp #272 (commit `cc57752`). No live src import. | `grep -l salvatore-primer src/` returns 0 in src; references survive only in decisions.md. |
| `scripts/finetune/format-salvatore-v3-sft.py`, `format-salvatore-v4-sft.py`, `train-salvatore-v5-stripped.py`, `submit-salvatore-training.ts`, `train-together-small.py` | archive-move | Retired Salvatore SFT pipeline. `docs/ablation/salvatore-v5-stripped.md` is the parked ablation; charter `salvatore-v5-corpus-expansion.md` is `status: draft` (no run). Primer/SFT extract+train scripts are unwired. | All five scripts have zero `src/` imports. Decisions/lessons have provenance. |
| `scripts/finetune/seed-adapter-registry-v3.ts` | archive-move | One-off seeder for the v3 adapter registry; no live import. | `grep` returns no src refs. |
| `scripts/finetune/archetype-poc/` (entire dir, 13 files) | archive-move | 2026-04 dialogue-archetype POC; LoRA dialogue-rewriter direction retired with the writer-LoRA route. | No `src/` imports. `docs/current-state.md` has no live reference. Decisions chain references the POC outcomes. |
| `scripts/hallucination/build-leak-v2-train.ts`, `eval-leak-adapter.ts`, `expand-leak-vocab.ts`, `harvest-v4-candidates.ts`, `halluc-v3-fire-rate.ts`, `eval-combined-v3.ts`, `sample-solo-ungrounded.ts`, `rung-0-regex-ceiling.ts` | archive-move | All Salvatore-route halluc-leak detection scripts — explicitly retired in exp #272 ("halluc-leak-salvatore Rung 0 shipped, then retired with the writer-LoRA route"). | Decisions has provenance; current-state §"Retired Methodologies" documents the retirement. No `src/` import. |
| `scripts/autonomous-loop/` (drift-detector.ts, driver.ts, kill-switch.ts, propose-next-planning-config.ts, score-iteration.ts, history/, variants/) | archive-move | Autonomous-loop direction was deprioritized 2026-04-21 per memory `project_context_engineering_priority` and `docs/current-state.md:360` "drift detector skeleton... no longer the active runtime checker strategy after exp #272." | Dir has its own README; `harness-optimization-inventory.md` already marks it superseded. SQL migration `032_drift_checks.sql` stays (migration discipline). |
| `scripts/evals/run-voice-shaping-ablation.ts`, `run-arm-d-upgrade.ts`, `run-arm-b-preflight.ts`, `preflight-arm-b-*.ts`, `run-salvatore-distinctness-v1.ts`, `tier-ordering-probe-v1.ts`, `conditioning-floor-*.ts`, `build-voice-shape-reference.ts`, `voice-shape-metrics.ts`, `voice-reference-passages.json`, `voice-shape-reference.json` | archive-move | Voice-shaping (`status: complete`), conditioning-floor (`status: concluded-kill`), tier-ordering (`status: killed`), arm-b/arm-d (charters in `docs/charters/arm-*-results.md` `status: results`) all closed. Decisions has rollups. | **Exception:** `arm-b-pairwise.ts` is imported by `src/orchestrator/server.ts:527` for the in-product pairwise ingest CLI — `keep-load-bearing` (see next row). |
| `scripts/evals/arm-b-pairwise.ts` (+ tests) | keep-load-bearing | Imported (spawn-shell) at `src/orchestrator/server.ts:527`. The orchestrator UI shells out to it for pairwise ingest. | Confirmed live runtime dependency. |

### Reverse-dep audit method

For each candidate above I ran `grep -rln <basename-stem>` across `src/` and `scripts/` and against the canonical docs (`current-state.md`, `todo.md`, `CLAUDE.md`, `package.json`). "No live import" means zero `src/` hits and either zero or only-decisions/charters hits in `docs/`. Charter and decisions-row references are not live imports — they're history.

## Old session docs

**All session docs in `docs/sessions/` are dated 2026-04-19 or later, every one post-cutoff.** Per the constraints, the entire `docs/sessions/` tree is `keep-load-bearing`. No proposals here.

The few non-dated entries (`README.md`, `TEMPLATE.md`, `lane-queue.md`, `overnight-loop-context-template.md`) are operational/template files — keep.

## Old result/report docs

These nine docs already carry `> HISTORICAL — superseded.` callouts (added in the 2026-05-01 docs sweep, exp #298). They are still cited from `decisions.md` and `current-state.md:419` where the supersession itself is the documented work.

| path | category | justification |
|---|---|---|
| `docs/hallucination-v3-wire-in-plan.md` | archive-move | Already marked `superseded-by` exp #272. Move to `docs/archive/2026-04/`. Keep filename; update cross-references in `decisions.md` to the new path. |
| `docs/pipeline-14b-consolidation.md` | archive-move | Same — `superseded-by` fine-tune-free direction. |
| `docs/beat-writer-architecture.md` | archive-move | Same — `superseded-by` exp #272. |
| `docs/hallucination-checker-findings.md` | archive-move | Already marked superseded (current-state §5 catalog). |
| `docs/lora-style-transfer-report.md` | archive-move | Already marked superseded. (59 KB — biggest reclaim.) |
| `docs/next-session-plan-2026-04-21.md` | archive-move | Already marked superseded by current `todo.md`. |
| `docs/codebase-audit-2026-04-18.md` | archive-move | Already marked superseded. |
| `docs/remediation-pass-2026-04-18.md` | archive-move | Already marked superseded. |
| `docs/harness-optimization-inventory.md` | archive-move | Already marked superseded. |

| `docs/halluc-v3-production-report-2026-04-20.md` | archive-move | Cited from `decisions.md:2595`; result of a concluded experiment. The report is historical but the citation is the load-bearing part — moving the file to `docs/archive/` requires updating that one decisions row. |
| `docs/rung-0-regex-ceiling-results.md` | archive-move | Cited from `decisions.md:2641`. Same disposition. |
| `docs/pp2-floor-pilot-results.md` | archive-move | Cited from `decisions.md:2648` and `current-state.md:353`. Same disposition. |

| `docs/next-session-plan.md` (2026-04-19) | archive-move | Cited only from `decisions.md:2508` ("Plan lives in `docs/next-session-plan.md` once regenerated") — a stale forward-pointer. The doc itself is pre-cutoff session-planning material now superseded by the active overnight-runbook + lane-queue model. Move to archive; update the decisions row. |

| `docs/program-direction-2026-04-21.md` | keep-load-bearing | Sets the post-pivot direction that's still in force per memory `project_context_engineering_priority`. Not superseded; it's a current strategic anchor. |
| `docs/autonomous-loop-roadmap-2026-04-21.md` | needs-§0a-first | Roadmap for the deprioritized autonomous-loop direction. Cited from `current-state.md:341`. Whether to archive depends on whether §0a or later world-bible work resurrects any of its concepts (drift detector, kill-switch). Revisit. |
| `docs/codex-preamble.md`, `docs/codex-usage.md` | keep-load-bearing | Codex-CLI subagent operating contract. Cited from CLAUDE.md indirectly via memory `feedback_codex_gpt54_subagents`. Live. |
| `docs/debug-injection-v2-spec.md` | keep-load-bearing | **Cited from `src/llm.ts:272, 592`, `src/orchestrator/novel-routes.ts:1413, 1417`, `src/debug/injection-types.ts:4`, `src/config/debug-injection.ts:3`.** Live runtime spec. |
| `docs/test-campaign-plan.md` | keep-load-bearing | **Cited from `src/config/debug-injection.ts:3`, `src/phases/drafting.ts:257`, `scripts/test/exhaustion-campaign.ts:4`, `scripts/test/exhaustion-web-campaign.ts:4`.** Live. |
| `docs/exhaustion-handler-design.md` | keep-load-bearing | Cited from `current-state.md:163` and `decisions.md:2439`. Live anchor. |
| `docs/salvatore-structural-analysis.md` | keep-load-bearing | **Cited from `src/harness/enforce.ts:66` (enforced-floor calibration) and `docs/context-engineering-plan.md`.** Live calibration anchor. |
| `docs/corpus-structural-analysis.md` | keep-load-bearing | Pre-cutoff but underpins the corpus pipeline doc class. Verify before move. |
| `docs/steps-4-5-plan.md` | needs-§0a-first | Pre-cutoff steps plan; possibly absorbed into world-bible Step 0 sequencing. Revisit after §0a. |
| `docs/voice-lora-salvatore.md`, `docs/writer-imitation-benchmark.md`, `docs/writer-style-imitation-design-space.md`, `docs/adapter-changelog.md`, `docs/adapter-training-reference.md`, `docs/fine-tuning-strategy.md` | keep-load-bearing | All cited from `current-state.md:309` ("historical-superseded doc pass" target list — these were planned to receive the next round of `> HISTORICAL` callouts but haven't yet). Not safe to archive until each carries its own `superseded-by` callout. **Action: complete the 2026-05-01 sweep on these six before considering archive.** |

## Old scripts

Top-level `scripts/` (not in subdirs) review:

| path | category | justification |
|---|---|---|
| `scripts/cleanup-orphans.ts` | keep-load-bearing | Cited from `decisions.md:2488, 2493` and `next-session-plan.md:104`. Active DB hygiene tool. |
| `scripts/dialogue-postpass-test.ts` | archive-move | Header: "Dialogue post-pass test — takes v4 LoRA dialogue lines from the fork-writer output…" — v4 LoRA writer route is retired. No current-state/todo references. |
| `scripts/fork-writer-test.ts` | archive-move | Header: comparison harness for v3 vs v4 writer LoRA — both retired. Cited only in `docs/designs/phase-modularization.md:518` (architectural refactor reference) and `docs/plans/2026-04-19-5-invariants.md:100` (codex-surfaced AST gap example). Replace those refs with comments before archive. |
| `scripts/fork-writer-v4-llama.ts` | archive-move | Same — v4 LoRA vs Llama 3.3 70B writer-fork comparison; retired direction. |
| `scripts/three-model-beat-compare.ts` | archive-move | Three-way writer comparison (v4 LoRA vs Llama 70B vs DeepSeek). v4 retired; DeepSeek now default. Comparison framework superseded by phase-eval module. |
| `scripts/test-planner-isolated.ts` | keep-load-bearing | Cited from `decisions.md:718` (current `coverage-balanced` validation), `docs/charters/revision-work-order-2026-04-18.md:37`, `docs/charters/planner-phase2-payoff-floor.md:303`. **Live planner smoke harness.** |
| `scripts/adherence-two-stage-smoke.ts` | keep-load-bearing | Smoke validator for the two-stage adherence checker shipped 2026-05-01. Live. |
| `scripts/operator-summary.ts`, `scripts/operator-summary.test.ts` | keep-load-bearing | Canonical operator CLI per `current-state.md:228`, `finished-novel-acceptance.md`, `agent-lane-protocol.md`. |
| `scripts/preflight-docs-impact.ts`, `scripts/preflight-docs-impact.test.ts` | keep-load-bearing | Canonical docs-impact gate per CLAUDE.md "End-of-work documentation sweep." |
| `scripts/preflight.ts` | keep-load-bearing | Cited from `finished-novel-acceptance.md` gate 1. |
| `scripts/status.ts` | keep-load-bearing (low-confidence) | Couldn't fully verify; flagging as keep until checked. Filename suggests live status CLI. |
| `scripts/planning-state-mapper-summary.ts` | keep-load-bearing | Cited from `todo.md` exp #297/#298. Live. |
| `scripts/deploy-lxc.sh` | keep-load-bearing | CLAUDE.md "Deployment Model" canonical deploy script. |
| `scripts/sync-improvements.sh` | archive-move | Pulls prompt/config from LXC to local. Pre-orchestration-pivot pattern; superseded by direct local-canonical editing per `CLAUDE.md` ("Local repo is canonical for editing"). No current-state/todo reference. Verify with user that the rsync workflow is no longer in active use before archive. |

Subdirectory survey (high-level only — execution-phase audit can deepen):

- `scripts/agent/` — keep-load-bearing entirely. This is the canonical interactive-captain control plane (per CLAUDE.md "Engineering orchestration boundary"). The `lane-runner.ts` legacy module stays per the same line.
- `scripts/lib/` — keep-load-bearing (`codex-preamble.ts`, `in-flight.ts` — both small support modules with active consumers).
- `scripts/lint/` — keep-load-bearing (live invariant checks per `docs/invariants.md`).
- `scripts/test/` — keep-load-bearing (`exhaustion-campaign.ts` referenced from `test-campaign-plan.md`).
- `scripts/finetune/` — mixed; the per-script audit above lists the archive-candidate Salvatore/Howard/v3-v4 SFT scripts. **Live keepers:** `provenance-report.ts`, `eval-db-read.ts`, `eval-db-write.ts`, `load-eval-briefs.ts`, `seed-adapter-registry.ts` (current registry), `ingest-corpus.py`, `extract-briefs.py`, `extract-scenes.py`, `segment-beats.py`, `tag-style.py` (corpus pipeline). Verify `train-lora.py` stays — current direction is fine-tune-free per memory but the script itself is generic infra.
- `scripts/structure-calibration/` — keep-load-bearing per current-state §"Corpus mining maturity step-up." 41 measured patterns under the directional-gate methodology, each tied to a `docs/harness-tuning-roadmap.md` row.
- `scripts/corpus/` — keep-load-bearing per `docs/corpus-pipeline.md`.
- `scripts/phase-eval/` — keep-load-bearing per active eval module work in `todo.md` §3.
- `scripts/hallucination/` — mixed; the per-script audit above splits live (`run-synthetic-checkers.ts`, `current-surface-manifest.ts`, `ner-vs-llm-calibration.ts`, `*-panel.ts`, `*-fixtures/`, `*-rubric.md`) from archive-candidates (leak-detection scripts).
- `scripts/evals/` — mixed (see per-script audit above).
- `scripts/replay/` — keep-load-bearing (lane L63/L65/L66/L68 replay scripts, recent 2026-05-02 work).
- `scripts/variant/` (`clone-for-variant.ts`) — keep-load-bearing (variant probe infra).
- `scripts/experiments/` (`backfill-planner-phase2-charter.ts`) — needs-§0a-first or archive-move; one-off backfill, verify it's not still scheduled.
- `scripts/arc-lab/transport-generation.ts` — keep-load-bearing (low-confidence; one-file dir, couldn't fully verify; no current-state ref but no obvious retirement either).
- `scripts/analysis/` — keep-load-bearing for the in-use analyzers; possibly archive-candidates among the older Python scripts but flagging as out-of-scope for this Phase-1 catalog without a deeper read.

## SQL migrations

`sql/` has 34 numbered migrations (`001_initial.sql` through `034_llm_call_ner_prepass.sql`). **No proposals for deletion.** Migration discipline is "kept for history even if the table is gone" per task constraints. `032_drift_checks.sql` corresponds to the autonomous-loop direction (deprioritized) but the table may still exist; not safe to drop.

## Other

- ~~`program.md` (7.4 KB) at repo root~~ — **moved to `docs/archive/program.md` (2026-05-09).** Self-labeled legacy autonomous-prompt-improvement loop, superseded by `docs/current-state.md`, `overnight-runbook.md`, and `experiment-design-rules.md`. Archived; no longer at root.
- `CONTEXT.md` at repo root — referenced from skill `improve-codebase-architecture`. Keep-load-bearing.
- `.DS_Store` at repo root — macOS metadata; gitignored. Not under cleanup scope.
- `output/`, `finetune-data/` at repo root — gitignored runtime artifacts; not under cleanup scope.
- `docs/scoping/halluc-leak-salvatore-v2.md` — corresponds to retired Salvatore-leak direction. `archive-move` candidate; sized small, low priority.
- `docs/plans/` (10 plan docs from 2026-04-19 / 2026-04-28) — all post-cutoff per the 2026-04-15 boundary; keep. Confirm the 2026-04-19 ones aren't pre-cutoff: dates are 2026-04-19 which is **after** 2026-04-15 → keep.
- `docs/retrospectives/` — both files post-cutoff; keep.
- `docs/charters/` — entire dir hands-off per task constraints (active and historical charters).
- `docs/patterns/`, `docs/designs/`, `docs/ablation/`, `docs/evals/`, `docs/artifacts/`, `docs/research/` — survey suggests all live or load-bearing; defer per-doc audit to execution phase.

## Recommended execution order

### Phase A — `safe-delete` (after audit work concludes)

These eight items have zero load-bearing dependencies and are explicitly regenerable per their own audit docs. Wait for the active checker-quality audit work to settle before deleting (the audit author may still be reviewing these JSON snapshots).

1. `adh-func-samples.json`
2. `halluc-fp-sample.json`
3. `checker-fp-samples.json`
4. `chapter-plan-checker-fp-sample.json`
5. `cpc-grading-input.json`
6. `cpc-grading-rich.json`

For the two underscore-prefixed scripts (`scripts/_cpc-rubric-replay.ts`, `scripts/_q-cpc.ts`): **rename + recommit + update audit-doc citations** is the better move than delete. They are referenced as the replication path from the audit docs.

### Phase B — `archive-move` (after Phase A)

Create `docs/archive/2026-04/` and `scripts/archive/` (or `_retired/`). Co-stage moves with citation updates in `decisions.md` rows that point at the moved path.

1. **Docs (low-risk, all already marked `superseded`):**
   - 9 docs catalogued in current-state §5 (hallucination-v3-wire-in-plan, pipeline-14b-consolidation, beat-writer-architecture, hallucination-checker-findings, lora-style-transfer-report, next-session-plan-2026-04-21, codebase-audit-2026-04-18, remediation-pass-2026-04-18, harness-optimization-inventory)
   - 3 result docs cited from decisions (halluc-v3-production-report-2026-04-20, rung-0-regex-ceiling-results, pp2-floor-pilot-results)
   - `next-session-plan.md` (2026-04-19)
2. **Scripts (medium-risk, verify zero src import per file before move):**
   - `scripts/finetune/` retired Salvatore/Howard/v3-v4 SFT pipeline (extract-howard-primer, extract-salvatore-primer, format-salvatore-v3-sft, format-salvatore-v4-sft, train-salvatore-v5-stripped, submit-salvatore-training, train-together-small, seed-adapter-registry-v3, archetype-poc/ entire dir)
   - `scripts/hallucination/` Salvatore-leak detection scripts (build-leak-v2-train, eval-leak-adapter, expand-leak-vocab, harvest-v4-candidates, halluc-v3-fire-rate, eval-combined-v3, sample-solo-ungrounded, rung-0-regex-ceiling)
   - `scripts/autonomous-loop/` entire dir
   - `scripts/evals/` retired ablation scripts (run-voice-shaping-ablation, run-arm-d-upgrade, run-arm-b-preflight, preflight-arm-b-*, run-salvatore-distinctness-v1, tier-ordering-probe-v1, conditioning-floor-*, build-voice-shape-reference, voice-shape-metrics, voice-reference-passages.json, voice-shape-reference.json) — **explicitly preserve `arm-b-pairwise.ts` (live runtime dep)**
   - `scripts/dialogue-postpass-test.ts`, `scripts/fork-writer-test.ts`, `scripts/fork-writer-v4-llama.ts`, `scripts/three-model-beat-compare.ts`, `scripts/sync-improvements.sh`
3. **Sweep updates:**
   - Update each `decisions.md` row that names a moved file to point at the new path.
   - Update `harness-optimization-inventory.md` superseded callout to point at new archive paths.

### Phase C — post-§0a (`needs-§0a-first`)

Wait for the world-bible §0a deterministic per-chapter bundle builder to land. Then revisit:

1. `src/db/embed.ts`, `src/db/retrieval.ts`, `src/harness/embeddings.ts`, the `src/agents/writer/context.ts` retrieval branch — §0a will rewrite the assembler. After it lands, delete the embeddings-flag-guarded dead branches if §0a doesn't reuse them.
2. `docs/autonomous-loop-roadmap-2026-04-21.md` — depends whether §0a or later steps resurrect any concepts.
3. `docs/steps-4-5-plan.md` — depends whether absorbed into world-bible Step 0/3 sequencing.
4. `scripts/experiments/backfill-planner-phase2-charter.ts` — verify no longer scheduled.
5. The six "still need historical-superseded callouts added" docs (voice-lora-salvatore, writer-imitation-benchmark, writer-style-imitation-design-space, adapter-changelog, adapter-training-reference, fine-tuning-strategy). Complete the 2026-05-01 sweep before archiving.

## Open questions for the user

1. **Underscore-prefix scripts (`scripts/_cpc-rubric-replay.ts`, `scripts/_q-cpc.ts`):** rename to a stable path and update audit-doc citations, or leave at the underscore-prefix as throwaway-but-pinned? Same question for `scripts/_step0e-cost-probe.ts`.
2. **`docs/archive/` vs `scripts/archive/` naming:** any preference? Existing repo has no `_retired/` or `archive/` convention — Phase B will establish one.
3. **`scripts/sync-improvements.sh`:** still in use, or fully superseded by local-canonical-editing? If superseded, archive in Phase B.
4. **Six docs needing historical-superseded callouts (current-state.md:309 follow-on list):** finish the sweep first, or move directly to archive with the callout written at move time?
5. **Voice-shaping-prompts module retention:** keep `src/agents/writer/voice-shaping-prompts.ts` for §0a L2 reference, or archive it? My recommendation is to defer until §0a settles the L2 layer.
