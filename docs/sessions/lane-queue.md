# Lane Queue

This file tracks active work only. Active implementation happens on `main`
unless the user explicitly requests a disposable branch.

## Active

- Authoring harness program loop: move visibility, interactivity, diagnostics, and evidence-backed runtime slices. See `docs/authoring-harness-program-loop.md`.
- Richness Backlog lane: fact roles remain A/B-only; semantic-gate diagnostics choose the next evidence-backed slice.
- Authoring visibility/interactivity at scope ceiling: direct-mutation
  audit found only deferred higher-risk slices (plan-assist whole-outline,
  chapter-plan-reviser outline replacement).

## Next

- Upstream native planning contract is directional hold after the controlled
  3-chapter planner comparison: better beat budget and mapper pressure, but
  story completeness/relationship texture needs scoring. Next either draft the
  controlled pair or add a planner-quality rubric; see L088.
- For local DB-backed diagnostics, verify `15432`; if down, use a temporary LXC Postgres SSH tunnel.
- Browser-test every UI-facing slice with Playwright MCP before handoff, close
  the browser session after the pass, and leave unconfirmed evidence as TODO
  rather than inferred.
- Keep creative heuristics diagnostic-only or A/B-gated until evidence proves
  value.
- Treat mechanically repairable prose syntax as a deterministic repair surface
  before Drafting retries or Plan-Assist Gates; keep semantic/content changes
  in Settle Loops, Reviser paths, or proposal/manual review.
- Before the next implementation slice, write the L87 change packet so phase,
  exact change, expected benefit, downstream projection, and evidence gate are
  explicit.

## Recently Closed

- `calibrated:packed` v1 shipped (commits `da6e39f`, `f8057d4`) and
  evaluated at N=12 × 4 arms × 1 chapter (experiment #479): matches
  `control:source` clean-pass count (10/12) at 1.76 mean word ratio (vs
  3.38) and 65% of control cost. Promotion remains `hold` per L086 — word
  ratio missed 1.75 by 0.01 and completion 10/12 vs better hard-cap 11/12.
  Audits show zero dropped obligations and zero dropped payoffs across all
  12 cells, but is now diagnostic evidence only per L088. Record:
  `docs/sessions/2026-05-06-pickup-planner-shape-baseline.md`.
- `nativePlanningContractV1` first slice shipped: default-off concept/planning
  context guidance, over-fragmentation retry/reject enforcement, and
  `test-planner-isolated` runner flag. Smoke on `phase-parity-smoke` produced
  5 beats for 1500w with clean planning token headroom.
- Controlled comparison on frozen `fantasy-system-heretic` concept produced
  legacy 24 beats vs native 18 beats. Native improved mapper headroom and
  avoided visible payoff-link sanitation, but still needs story-quality and
  downstream drafting evidence.
- Additional recent UI, diagnostics, checker, proposal, traceability, test, and
  lineage closures are archived in
  `docs/sessions/archive/lane-queue-2026-05-06-recent-closed.md`.

## Parked

- Broader checker entity resolution for aliases, display-name variants,
  outline-derived entities, free-form allowed-new entities, and legacy
  world-location refs remains parked until there is a canonical entity registry
  or explicit checker output contract.
- Artifact/Canon checker observation sources are backlog until concrete
  artifact-aware or Canon-generation-aware observers exist.
- External CI for `policy:promotion-guard` is on hold indefinitely. Keep the
  local guard as the supported path unless the user reopens a concrete CI need.

Closed history:
`docs/sessions/archive/lane-queue-2026-05-04-full.md`,
`docs/sessions/archive/lane-queue-2026-05-06-recent-closed.md`.
