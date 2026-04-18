---
status: active
kind: archive-index
---

# Charter Archive

Superseded and retired charters live here. The active surface is in `docs/charters/` one level up. Anything in this directory is history — **do not resurrect a charter from the archive without superseding the successor** per `docs/commit-conventions.md` "Superseded Documents."

Entries are ordered by archive date, newest first.

## Index

| Archived | Original | Status | Reason | Successor |
|---|---|---|---|---|
| 2026-04-18 | `planner-phase2-contract.md` | superseded | RED verdict from `/codex:adversarial-review` on 2026-04-18 (sessions `019da279-313c-7863-aad8-f483ff08e9d7` + rescue-forwarded duplicate) — 5 blocking issues: ungrounded effect sizes, sandbagged floor, underpowered sample (9 paired observations vs the claimed P<0.05), moving verifier surface, baseline contamination (V1a already landed on `main`). | [`docs/charters/planner-phase2-payoff-floor.md`](../planner-phase2-payoff-floor.md) |

## Conventions reminder

When adding an entry:

1. The archived file must carry `status: superseded`, `superseded_by: <path>`, `archived: YYYY-MM-DD` in frontmatter (preserving any existing `adversary-verdict` field).
2. The successor carries `supersedes: <path>` pointing back.
3. Both the move and this README update land in a single `[archive]` commit. The successor is NOT amended in the same commit.

See `docs/commit-conventions.md` §"Superseded Documents" for the full rule set.
