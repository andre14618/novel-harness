# Phase Parity Harness

Byte-parity gate for the phase-modularization refactor. Records a real Novel
run's LLM calls + final DB state, then replays the LLM transport and asserts
that the post-replay DB state byte-equals the recorded expectation.

Lives at this path so `bun test` picks it up automatically.

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
| UUID PKs | Replaced with stable hash of (table, business-key fields) |
| Serial PKs without business-key remap | Replaced with `<table>:row-<idx>` |
| Floating-point columns | Rounded to 6 decimal places |
| Large text/JSONB (prompts, prose, scenes_json, etc.) | Replaced with `<HASH:sha256-prefix>` |
| Foreign-key UUIDs | Replaced with stable hash |

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
| `phase-parity.test.ts` | The byte-equal assertion — skipped when fixture absent |
| `fixtures/reference-run/` | Recorded fixture: `transport-fixture.json`, `expected-snapshot.json`, `seed.json` |

## Recording a fixture (run on LXC)

The fixture must come from a real run, not a local dev environment, because:

1. Recording requires a working `DATABASE_URL` and provider API keys.
2. The DB snapshot includes content that depends on production agent prompts
   and model assignments, which are seeded from `src/models/roles.ts`.
3. We want the fixture to represent the harness as users actually run it.

```bash
ssh novel-harness-lxc \
  "cd ~/apps/novel-harness && bun tests/phase-parity/record-fixture.ts romance-drama"
```

Then sync back:

```bash
rsync -avz novel-harness-lxc:apps/novel-harness/tests/phase-parity/fixtures/ \
  ./tests/phase-parity/fixtures/
git add tests/phase-parity/fixtures/
git commit -m "[test] record phase-parity reference fixture"
```

## Running the test

```bash
bun test tests/phase-parity/phase-parity.test.ts
```

Without a fixture: the test is skipped with the message
`fixture recording required — see README.md`.

With a fixture: the test runs `runNovel(novelId)` against the
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
