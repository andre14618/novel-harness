# Phase Parity Harness

Byte-parity gate for the phase-modularization refactor. Records a real Novel
run's LLM calls + final DB state, then replays the LLM transport and asserts
that the post-replay DB state byte-equals the recorded expectation.

Lives in the explicit replay tier so stale fixtures do not block fast or DB
integration gates.

## Why this matters

The replay harness gives the Novel Harness a deterministic regression test for
an otherwise stochastic system. A normal end-to-end novel run depends on live
LLM responses, provider latency, model routing, prompt text, DB writes, checker
ordering, and gate behavior. If a later code change makes the pipeline behave
differently, a live rerun may blur the cause because the model can also change
its answer. Replay removes that noise.

The fixture freezes the LLM boundary:

1. Recording captures each outbound LLM request and its response.
2. Replay serves those recorded responses back to the pipeline by request hash.
3. The test snapshots the resulting DB state and compares it to the recorded
   normalized expectation.

That means the harness can answer a narrow question: "Given the same seed and
the same model responses, did our orchestration, persistence, proposal, checker,
and phase-transition code produce the same novel state?" If not, the source
change affected deterministic harness behavior and needs either a fix or a
deliberate fixture refresh.

For the broader AI novel system, this protects the machinery that turns plans
into prose:

- phase transitions stay stable across Concept, Planning, Drafting, and
  Validation;
- chapter outlines, beats, stable IDs, planned state, drafts, issues, LLM
  telemetry, and pipeline events keep the same persistence shape;
- checker warnings/blockers and approval behavior do not silently drift;
- refactors can be separated from creative-output experiments;
- fixture refreshes become explicit evidence that a pipeline behavior change
  was intentional.

It does not prove the generated prose is "better." It proves the harness is
still applying the same deterministic process around the frozen creative calls.
Quality changes still need component evals, A/B probes, or live smoke runs.

## What's checked

The harness covers the table set documented in
`docs/designs/phase-modularization.md` §"Parity harness — full table scope"
(R3). Concretely: 19 tables — Concept (8), Planning (1), Drafting (5),
Validation (2), and telemetry (`llm_calls`, `pipeline_events`). Plus
SHA-256 hashes of every approved chapter's prose.

Snapshot normalization:

| Field type | Treatment |
|---|---|
| `created_at`, `timestamp`, `*_at` columns | Replaced with `"<TS>"` |
| telemetry `duration_ms` columns | Replaced with `"<DURATION>"` |
| UUID PKs | Replaced with stable hash of (table, business-key fields) |
| Serial PKs without business-key remap | Replaced with `<table>:row-<idx>` |
| Floating-point columns | Rounded to 6 decimal places |
| Large text/JSONB (prompts, prose, scenes_json, etc.) | Replaced with `<HASH:sha256-prefix>` |
| Foreign-key UUIDs | Replaced with stable hash |

`pipeline_events` are compared as a logical multiset rather than by serial
insertion order because replay runs faster and parallel checker events can
interleave differently from recording.

Hashed-field list lives in `db-snapshot.ts:HASHED_FIELDS`; comparison key
fields per table are in `normalize.ts:REMAP_PK_CONFIG`. Both must stay in
sync with `docs/designs/phase-modularization.md`.

## Files

| File | Role |
|---|---|
| `db-snapshot.ts` | `captureSnapshot(novelId)` returns raw per-novel state across all 19 tables, ordered by PK |
| `normalize.ts` | `normalize(raw)` strips timestamps/UUIDs/serial-IDs, rounds floats, hashes large content |
| `replay-transport.ts` | `RecordTransport` wraps DirectTransport and logs calls; `ReplayTransport` serves recorded responses by hashed request key |
| `record-fixture.ts` | Recording entry point — runs on the LXC against a real DirectTransport, captures fixture |
| `phase-parity.test.ts` | The byte-equal assertion — skipped unless replay is explicitly enabled |
| `fixtures/reference-run/` | Recorded fixture: `transport-fixture.json`, `expected-snapshot.json`, `seed.json` |

## Recording a fixture (run on LXC)

The fixture must come from a real run, not a local dev environment, because:

1. Recording requires a working `DATABASE_URL` and provider API keys.
2. The DB snapshot includes content that depends on production agent prompts
   and model assignments, which are seeded from `src/models/roles.ts`.
3. We want the fixture to represent the harness as users actually run it.

```bash
ssh novel-harness-lxc \
  "cd ~/apps/novel-harness && bun tests/phase-parity/record-fixture.ts phase-parity-smoke"
```

The reference fixture should use `phase-parity-smoke`: a deliberately small
one-chapter seed that still exercises concept, planning, drafting, validation,
telemetry, and snapshot normalization without making the parity gate depend on
multi-chapter semantic-checker luck.

Then sync back:

```bash
rsync -avz novel-harness-lxc:apps/novel-harness/tests/phase-parity/fixtures/ \
  ./tests/phase-parity/fixtures/
git add tests/phase-parity/fixtures/
git commit -m "[test] record phase-parity reference fixture"
```

## Running the test

```bash
bun run test:replay
```

Without `PHASE_PARITY_REPLAY=1`: the test is skipped with the message
`set PHASE_PARITY_REPLAY=1 to run fixture replay parity`. The package script
sets this flag for you.

Without a fixture: the enabled test is skipped with the message
`fixture recording required — see README.md`.

With the flag and a fixture: the test runs `runNovel(novelId)` against the
`ReplayTransport`, snapshots the DB, normalizes, and asserts byte-equal vs
the recorded expected snapshot.

## Failure modes

- **`ReplayTransport miss`**: the agent layer issued an LLM request that
  isn't in the fixture. Either an agent's prompt changed (drift), or a new
  call site was introduced. Re-record the fixture in a dedicated commit.
- **Normalized snapshot mismatch**: the diff lives between
  `expected-snapshot.json` and the captured snapshot (saved next to it for
  debugging). Either the change is intentional and the fixture should be
  re-recorded, or it's a regression and the source change should be
  reverted/fixed.

## Discipline

Re-recording the fixture is **deliberate**. It must be its own commit, with
a message that explains *why* the prior fixture is no longer valid. Avoid
re-recording in the same commit as a refactor — it defeats the parity gate.

## Scope

This harness is the prerequisite for the phase-modularization P-series
(P1–P8) per `docs/designs/phase-modularization.md`. It is not currently
load-bearing for any other change, but is intended to remain in the suite
long-term as a regression check for orchestration refactors (analogous to
`tests/beat-context-parity.test.ts` for beat-context).
