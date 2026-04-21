---
status: frozen-2026-04-21
eval: rewrite-capability-probe
---

# Rewrite-capability judge prompt (frozen, rewrite-probe-v1)

**Judge model:** gpt-5.4 via Codex `exec` sub-command, OR DeepSeek V3.2 for
batch-friendly judgment (see §Model selection below).  
**Format:** blind pairwise, A/B label assignment swapped per pair via seeded
sha256 shuffle (same protocol as `conditioning-floor-judge-prompt.md`).  
**Rubric families:** three separate passes per pair — repetition-reduction,
voice-distinctness, overall quality.

## Anti-circularity constraint (§10.1 round-1 RED finding #4)

**The judge MUST NOT be the same model family used to generate the critique
strings in the critique artifact.**

The rewrite-probe charter's round-1 RED review flagged that using Sonnet as
both (a) the voice-collapse critic (critique generation) and (b) the
pairwise judge creates circularity: a positive result would be compatible
with "Sonnet prefers outputs that satisfy Sonnet-authored critiques" rather
than "the LoRA can rewrite." This invalidates the experiment.

**Recommended model routing:**

| Critique source | Judge |
|----------------|-------|
| Sonnet (voice-collapse detection) | gpt-5.4 (Codex exec) OR DeepSeek V3.2 |
| DeepSeek V3.2 (critique generation) | Sonnet via Agent subagents |
| Detector-only (no LLM critique) | Any of the above — no circularity risk |

For the initial probe where voice-collapse uses the `detectVoiceCollapse`
stub (returns `[]`) and all critique comes from deterministic detectors
(`detectRepetition` + `detectUnderlength`), there is no LLM critique source
and any judge model is acceptable. If/when the voice-collapse stub is
implemented with a real LLM, the judge model MUST be different.

**Current recommendation:** gpt-5.4 via Codex exec. Rationale: the Salvatore
v4 training-data build path does not include gpt-5.4 as a label source,
keeping the circularity check clean. This is the same rationale as
`docs/evals/conditioning-floor-judge-prompt.md §Lineage`.

Sonnet via Agent subagents remains an option if the critique generation uses
DeepSeek V3.2 (not Sonnet). Sonnet is NOT acceptable as judge if
`detectVoiceCollapse` is implemented with a Sonnet call.

---

## Rubric 1 — Repetition-reduction

**Question:** Which version has less harmful repetition?

### System prompt

```
You are scoring a blind pairwise repetition-reduction eval on fantasy prose.
Two versions of the SAME scene were drafted from the same beat description,
the same POV character, and the same supporting characters. One version was
drafted without critique; the other was given a targeted rewrite instruction
naming a specific repetition problem. You do NOT know which is which.

Your job: decide which version has LESS harmful repetition — verbatim
repeated phrases, looping dialogue exchanges, or redundant rephrasings that
make the prose feel stuck or circular.

Respond with ONLY valid JSON:
{"winner": "V1" | "V2" | "tie", "reasoning": "<1-2 sentences citing specific repeated phrases found in the losing version, or explaining the tie>"}
```

### User prompt template

```
SCENE:
- POV: {pov_character}
- Characters speaking: {characters_present joined by " + "}
- Beat: {beat_description}

VERSION V1:
{arm_a_prose}

VERSION V2:
{arm_b_prose}
```

### Rubric notes

- Focus ONLY on harmful repetition — phrases or exchanges that loop in a way
  that reads as a drafting artifact, not intentional stylistic anaphora.
- Intentional repetition for emphasis (e.g., a rhetorical triplet) does not
  count against a version.
- If both versions contain equally bad repetition loops, score "tie".
- Cite at least one specific phrase from the losing version when explaining.
- Do NOT factor in prose quality, length, or voice distinctness — those are
  scored in separate passes.
- The judge does NOT see the critique text that was given to the writer. Both
  versions are judged on their prose output only.

---

## Rubric 2 — Voice-distinctness

**Question:** Which version has more distinct character voices?

This rubric is adapted verbatim from `docs/evals/conditioning-floor-judge-prompt.md`
but applied to two versions of the SAME beat (V1 vs V2) rather than two arms
of the same beat.

### System prompt

```
You are scoring a blind pairwise voice-distinctness eval on fantasy prose.
Two versions of the SAME scene were drafted with the same beat description,
the same POV character, the same supporting characters, and the same
underlying plan. One version was drafted without critique; the other was
given a targeted rewrite instruction. You do NOT know which is which.

Your job: decide which version has more distinct character voices — where
distinct means that each speaking character sounds clearly different from
the others in cadence, diction, syntax, and register.

Respond with ONLY valid JSON:
{"winner": "V1" | "V2" | "tie", "reasoning": "<1-2 sentences citing specific lines>"}
```

### User prompt template

```
SCENE:
- POV: {pov_character}
- Characters speaking: {characters_present joined by " + "}
- Beat: {beat_description}

VERSION V1:
{arm_a_prose}

VERSION V2:
{arm_b_prose}
```

### Rubric notes

- "Distinct" is about **between-character differentiation within the same
  scene**. NOT about overall prose quality.
- If both versions collapse the speakers into one voice, score "tie".
- Cite at least one concrete phrase from each version when explaining. Vague
  reasoning ("V1 sounds more natural") is not acceptable.
- Ignore plot / pacing / description quality — those are controlled by the
  shared plan.
- Ignore which version is longer or has more polished prose mechanics. The
  only axis is voice separation.
- This rubric is identical in shape to the conditioning-floor rubric (same
  judge, same format). Results from both evals are comparable.

---

## Rubric 3 — Overall quality (tiebreaker)

**Question:** Which version is better overall?

This rubric is a sanity check and tiebreaker. It is NOT a primary gate —
results on rubrics 1 and 2 govern the H1/H2/H3 hypotheses. Overall quality
is reported in the write-up as a secondary signal only.

### System prompt

```
You are scoring a blind pairwise overall-quality eval on fantasy prose.
Two versions of the SAME scene were drafted from the same beat description
and the same characters. One version was drafted without critique; the other
was given a targeted rewrite instruction. You do NOT know which is which.

Your job: decide which version is better overall as a piece of narrative
prose — considering prose rhythm, specificity, voice, and engagement.

Respond with ONLY valid JSON:
{"winner": "V1" | "V2" | "tie", "reasoning": "<1-2 sentences explaining the preference>"}
```

### User prompt template

Same as rubrics 1 and 2 (identical scene header + VERSION V1 / VERSION V2
blocks).

### Rubric notes

- This is an open-ended holistic assessment. All axes count.
- If the versions are genuinely indistinguishable in overall quality, score
  "tie". Tiebreaking for its own sake is not required.
- Results here do NOT override rubric 1 or 2 outcomes.

---

## A/B shuffle protocol

Identical to `docs/evals/conditioning-floor-judge-prompt.md §A/B shuffle
protocol`:

For each pair, the caller computes `sha256(seed + pair_id)`, reads the first
uint32, and assigns arm positions (V1 = arm_a, V2 = arm_b, or vice versa)
based on whether the value is even or odd. Default seed:
`rewrite-probe-v1`.

The judge never sees arm labels ("redraft", "rewrite") — only "VERSION V1"
and "VERSION V2". After the judge returns a winner, the caller maps the
winning position back to the original arm label using the shuffle map.

Three separate judge passes are made per pair (one per rubric). Each pass is
independent: the judge does NOT see prior rubric outputs. This prevents
anchoring.

---

## Concurrency and invocation

Use Sonnet via Agent subagents (NOT codex exec) for concurrent judgment. The
conditioning-floor pilot discovered that codex exec loses responses under
concurrency; subagents handle parallel pairs correctly.

See `~/.claude/projects/.../memory/feedback_codex_plugin_subagentic_concurrency.md`
for the original failure mode documentation.

Recommended batch size: 5 pairs per subagent call (3 rubric passes × 5 pairs
= 15 judge calls per subagent batch). This keeps each subagent well within
context limits.

---

## Mechanical auto-loss (pre-filter before judge)

Beats that are mechanically unacceptable do NOT enter the LLM judge. Apply
`resolveLossShortCircuit` (from the conditioning-floor replay runner) before
dispatching judge calls:

- Underlength (< 50 words): the version is a mechanical loss regardless of
  content. Record `auto_loss=true` in the output JSONL; do not pass to judge.
- Error / empty response: same treatment as underlength.
- If BOTH versions are mechanical losses on the same pair, the pair is
  excluded from all three rubric win-rate calculations.

---

## Freeze rule

This document is frozen at `status: frozen-2026-04-21`. Any methodological
change (different judge model, different rubric axis, different prompt
template, different shuffle seed) requires a new artifact name, starting at
`rewrite-capability-judge-prompt-v2.md`. Do not edit this file after the run
starts — any correction requires aborting and restarting with a new frozen
document.
