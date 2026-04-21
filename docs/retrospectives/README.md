# Retrospectives

Directory for **experiment-arc narratives** that don't fit the other
canonical doc classes:

- `docs/decisions.md` — append-only architectural decisions. Answers "what did we decide and why?"
- `docs/lessons-learned.md` — distilled rules extracted from experiments. Answers "what should future sessions do differently?"
- `docs/current-state.md` — canonical live truth about the running system. Answers "what does the harness actually do right now?"
- `docs/charters/` — experiment charters (+ results memos). Answers "what question is this experiment asking, and what did it find?"
- `docs/todo.md` — pending action items. Answers "what's left to do?"

Retrospectives answer a different question: **"what happened across this multi-experiment arc, and why?"** — they capture evidence chains, review-round patterns, meta-consult interventions, and strategic reframes that span multiple charters and would lose structure if atomized into the other doc classes.

## When to write a retrospective

Write one when a session or experiment arc produces:

- A strategic pivot backed by multiple experiments (e.g., the 2026-04-21 LoRA-track freeze)
- A review-tower pattern that required meta-consultation (e.g., the 9-round `arm-b-detector-preflight` arc that pivoted via meta-consult)
- A class-of-bug narrative visible only across multiple commits (e.g., the request-json-as-TEXT + JSONB-as-string bug pair)
- An instrument-design iteration that produced a novel pattern worth documenting for future sessions

Do NOT write one when:

- A single charter lands cleanly → the charter itself + results memo are sufficient
- The decision is narrow → it belongs in `decisions.md`
- The rule is distillable → it belongs in `lessons-learned.md`

## Format

No strict template; the retrospective is narrative, not structured data. Typical sections:

- **Status header** — draft vs complete; pending resolutions
- **Scope** — what the retrospective covers, what it doesn't
- **Timeline** — chronological evidence
- **Strategic question / reframe** — if applicable
- **Meta-consults** — external sanity checks invoked, with job IDs
- **Pre-registered next step** — what the retrospective's outcome depends on
- **Open questions** — what the retrospective explicitly doesn't resolve
- **Process notes for future retrospectives** — reusable observations

Retrospectives can be drafts for a long time. A draft retrospective pending an experimental gate is a FEATURE — it prevents writing decisions around unresolved questions. Flip to `status: complete` only after the dependent experiments resolve.

## Index

- [2026-04-21 — voice-LoRA track evidence](2026-04-21-lora-track-evidence.md) — the four-negative-signal arc that led to the voice-LoRA-track freeze and DeepSeek V3.2 strategic-writer pivot. Status: draft pending `voice-shaping-ablation-v1` resolution.
