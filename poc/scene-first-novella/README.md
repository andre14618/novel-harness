# Scene-First Novella POC

A vertical, reviewable artifact of the scene-first writer architecture. The
goal is **one readable thing** — three chapters of prose plus the planner's
scene contracts plus post-hoc diagnostics, rendered as a static HTML page —
not a production-ready system.

## Lane discipline

This packet runs under [L100 — POC acceleration lane](../../docs/decisions/L100-poc-acceleration-lane.md).

- **Production defaults are NOT touched.** Every scene-first flag
  (`scenePlanContractV1`, `sceneCallWriterV1`, `writerExpansionMode`,
  `draftCaptureModeV1`) is set on a single novel via
  `seed.pipelineOverrides`. Other novels in the database are unaffected.
- **Traceability IDs are preserved in the review artifacts.** Per L099, the open
  ablation question is whether raw IDs render in the prose-writer prompt;
  obligation/source/thread/promise/payoff IDs remain in scene contracts and the
  rendered HTML when present. Trace files preserve runtime-emitted scene IDs,
  LLM-call metadata, and event payloads; they do not imply that every
  obligation/source/character ID is repeated on every trace event.
- **Chapter-level checker settle loops are skipped** in this POC via
  `draftCaptureModeV1=true` so prose collection survives checker hangs.
  Diagnostics run post-hoc as standalone V4 Flash judges.
- **Stop conditions** for this POC: production defaults would change,
  traceability IDs would be lost, or the planner produces unusable scene
  contracts (zero populated fields across all scenes — runner warns and
  continues). `plannerSceneContractFieldRate` in `run-summary.json` is the
  backwards-compatible any-field rate; use `sceneContractCoverage` for precise
  core-field and choice-field counts.

## Run sequence

Three commands, in order, against a single output directory.

```bash
# 1) Plan + draft + capture artifacts (~5–15 min on LXC, depending on
#    chapter count and writer expansion). Default fixture is P3
#    (pre-resolved debt-binder), default chapter count is 3.
bun poc/scene-first-novella/run.ts \
  --fixture docs/fixtures/scene-first/concepts/pre-resolved/P3-debt-binder-resolved.json \
  --chapters 3 \
  --writer-expansion-mode retry-short-scenes-v1 \
  --run-id poc-scene-first-$(date +%s)

# 2) Post-hoc diagnostics: V4 Flash judges (endpoint-landing per chapter,
#    scene-dramaturgy + character-agency per scene). Writes
#    chapter-N.diagnostics.json alongside the prose. Errors per scene are
#    captured non-fatally; partial results are preserved.
bun poc/scene-first-novella/diagnostics.ts \
  --run-dir poc/scene-first-novella/output/<runId>

# 3) Static HTML review page plus closure notes. Writes index.html,
#    review-summary.json, and findings.md in the run dir. Open the HTML
#    with a browser; no server or React build step.
bun poc/scene-first-novella/render-html.ts \
  --run-dir poc/scene-first-novella/output/<runId>

# Optional evidence-loop comparison against the completed baseline P3 run.
bun poc/scene-first-novella/compare-runs.ts \
  --baseline poc/scene-first-novella/output/poc-scene-first-1778423752 \
  --variant poc/scene-first-novella/output/<runId> \
  --out poc/scene-first-novella/output/<runId>/comparison.md

# Optional repair path: re-capture artifacts for an already-finished novel
# after fixing capture/render code. Requires the DB row to still exist.
bun poc/scene-first-novella/run.ts \
  --capture-only \
  --run-id <existingNovelId>
```

Use `--writer-expansion-mode off` for expansion-ablation runs that should keep
the same planner fixture but skip the retry-short-scenes expansion path.
Use `--planning-note-preset single-obligation-hardcap-v2` for prompt-only
load-control runs, and `--obligation-control chapter-budget-v1` for the
POC-only deterministic obligation compactor. For mapper-minimization runs,
start the process with
`PLANNING_STATE_MAPPER_PROMPT_OVERRIDE=poc/scene-first-novella/state-mapper-minimal-system.md`.

The resulting `poc/scene-first-novella/output/<runId>/` contains:

```
seed.json                         resolved seed + fixture path
run-summary.json                  profile, coverage, traceability, usage stats
chapter-N.md                      prose + header
chapter-N.scene-contracts.json    full outline_json row
chapter-N.trace.json              pipeline_events + llm_calls metadata
chapter-N.diagnostics.json        endpointLanding + per-scene judges
obligation-control-report.json    optional compactor report
review-summary.json               aggregate review stats + finding bullets
findings.md                       concise reader-visible POC findings
comparison.md                     optional baseline-vs-variant report
index.html                        static review page
```

## LXC run (recommended)

The runner uses Postgres + the orchestrator DB; LXC is the canonical runtime.

```bash
# From the repo root, deploy + run + pull artifact back.
bash scripts/deploy-lxc.sh
RUN_ID="poc-scene-first-$(date +%s)"
ssh novel-harness-lxc "cd ~/apps/novel-harness && nohup bun poc/scene-first-novella/run.ts \
  --fixture docs/fixtures/scene-first/concepts/pre-resolved/P3-debt-binder-resolved.json \
  --chapters 3 \
  --run-id ${RUN_ID} \
  > /tmp/${RUN_ID}.log 2>&1 &"

# Watch progress; when run.ts exits, kick off diagnostics + HTML on LXC, then rsync back.
ssh novel-harness-lxc "cd ~/apps/novel-harness && bun poc/scene-first-novella/diagnostics.ts --run-dir poc/scene-first-novella/output/${RUN_ID}"
ssh novel-harness-lxc "cd ~/apps/novel-harness && bun poc/scene-first-novella/render-html.ts --run-dir poc/scene-first-novella/output/${RUN_ID}"
rsync -av novel-harness-lxc:apps/novel-harness/poc/scene-first-novella/output/${RUN_ID}/ poc/scene-first-novella/output/${RUN_ID}/
```

## Fixtures

POC defaults to **P3 — pre-resolved debt-binder**, the clean-attribution
profile (every named role pre-supplied, no casting gap to fight). Other
profiles live under `docs/fixtures/scene-first/concepts/`:

- `over-target/P1-fantasy-debt-binder.json` — the 1.0× baseline
- `undershoot/P2-archive-deciphering.json` — exploratory shape, fewer fixed roles
- `pre-resolved/P3-debt-binder-resolved.json` — POC default (this packet)
- `pre-resolved/P3-debt-binder-tight-scope.json` — follow-up scope-control
  variant for testing scene count, obligation density, endpoint/hook fit, and
  chapter split control against the completed P3 baseline
- `pre-resolved/P3-debt-binder-density-cap.json` — density-isolation variant
  that holds the tight-scope 9-scene shape steady while testing lower
  obligation load
- `frozen-plan/novel-1778411555121-ch1-ch2/` — captured real plan (P4)

See `docs/fixtures/scene-first/README.md` for the full design rationale and
when to swap profiles.
