# Workflow Atlas

The workflow atlas is a repeatable standalone HTML map of the harness. It has
two modes:

- Static mode maps the production architecture without needing a database.
- Run overlay mode adds actual telemetry for a `novelId`: phase, chapters,
  scene refs, draft word counts, LLM call stats, trace event mix, and timeline.

## Static Map

```bash
bun run diagnostics:workflow-atlas -- --out output/workflow-atlas/static/index.html --open
```

## Run Overlay

```bash
bun run diagnostics:workflow-atlas -- \
  --novel test-planner-mercenary-rillgate-saltmine-1778674224711 \
  --out output/workflow-atlas/rillgate/index.html \
  --open
```

The output is ignored under `output/`, so regenerate it whenever the harness or
run changes.

## What It Shows

- Intent/configuration: seed packet, directives, decisions.
- Concept: world, characters, story spine.
- Planning: skeleton, scene expansion, state mapper, enforcement.
- Drafting: writer context, drafting brief, writer, checkers.
- Review: Plan Readiness, planning proposals, canon proposals.
- Telemetry: trace events, `llm_calls`, quality reports.
- Operator surfaces: pipeline UI, planning studio, chapter traceability.

Use this when the question is "where does this data get fed?", "is this main
path?", "what owns this decision?", or "why did this run stop?"
