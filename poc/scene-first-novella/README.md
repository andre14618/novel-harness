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
- **Traceability IDs are preserved** end-to-end. Per L099, the open
  ablation question is whether raw IDs render in the prose-writer prompt;
  obligation/source/thread/promise/payoff IDs remain in scene contracts,
  trace events, and the rendered HTML.
- **Chapter-level checker settle loops are skipped** in this POC via
  `draftCaptureModeV1=true` so prose collection survives checker hangs.
  Diagnostics run post-hoc as standalone V4 Flash judges.
- **Stop conditions** for this POC: production defaults would change,
  traceability IDs would be lost, or the planner produces unusable scene
  contracts (zero populated fields across all scenes — runner warns and
  continues).

## Run sequence

Three commands, in order, against a single output directory.

```bash
# 1) Plan + draft + capture artifacts (~5–15 min on LXC, depending on
#    chapter count and writer expansion). Default fixture is P3
#    (pre-resolved debt-binder), default chapter count is 3.
bun poc/scene-first-novella/run.ts \
  --fixture docs/fixtures/scene-first/concepts/pre-resolved/P3-debt-binder-resolved.json \
  --chapters 3 \
  --run-id poc-scene-first-$(date +%s)

# 2) Post-hoc diagnostics: V4 Flash judges (endpoint-landing per chapter,
#    scene-dramaturgy + character-agency per scene). Writes
#    chapter-N.diagnostics.json alongside the prose. Errors per scene are
#    captured non-fatally; partial results are preserved.
bun poc/scene-first-novella/diagnostics.ts \
  --run-dir poc/scene-first-novella/output/<runId>

# 3) Static HTML review page. Single index.html in the run dir. Open with
#    a browser; no server, no React, no Playwright.
bun poc/scene-first-novella/render-html.ts \
  --run-dir poc/scene-first-novella/output/<runId>
```

The resulting `poc/scene-first-novella/output/<runId>/` contains:

```
seed.json                         resolved seed + fixture path
run-summary.json                  profile, planner field rate, drafting kind
chapter-N.md                      prose + header
chapter-N.scene-contracts.json    full outline_json row
chapter-N.trace.json              pipeline_events + llm_calls metadata
chapter-N.diagnostics.json        endpointLanding + per-scene judges
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
- `frozen-plan/novel-1778411555121-ch1-ch2/` — captured real plan (P4)

See `docs/fixtures/scene-first/README.md` for the full design rationale and
when to swap profiles.
