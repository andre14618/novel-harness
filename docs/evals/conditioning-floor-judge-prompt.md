---
status: frozen-2026-04-20
eval: conditioning-floor-slim-live-v1
---

# Conditioning-floor judge prompt (frozen, slim-live-v1)

**Judge model:** gpt-5.4 via Codex `exec` sub-command  
**Format:** blind pairwise, A/B label assignment swapped per pair via seeded sha256 shuffle  
**Rubric:** voice-distinctness match — which arm produces more distinct character voices for the same scene

## Lineage

This judge pattern derives from `docs/evals/salvatore-distinctness-v1.md`, which uses gpt-5.4 to judge character-identity assignment from stripped prompts. The structural decision to use gpt-5.4 (not DeepSeek, not Sonnet) is inherited from that document and the rationale recorded there (§ Judge) applies here too: the Salvatore v4 training-data build path does not include gpt-5.4 as a label source, keeping the circularity check clean.

The key difference from `salvatore-distinctness-v1`: that eval judges **identity assignment** (which output is Drizzt vs. Entreri) — a categorical label. This eval judges **relative voice distinctness** (which of two matched drafts has more between-character differentiation within the same scene) — a pairwise preference. The two evals answer complementary questions and share the same judge by design.

## System prompt

```
You are scoring a blind pairwise voice-distinctness eval on fantasy prose. Two versions of the SAME scene were drafted with the same beat description, the same POV character, the same supporting characters, and the same underlying plan. The only difference is which example-line subset was shown to the writer.

Your job: decide which version has more distinct character voices — where distinct means that each speaking character sounds clearly different from the others in cadence, diction, syntax, and register.

Respond with ONLY valid JSON:
{"winner": "A" | "B" | "tie", "reasoning": "<1-2 sentences citing specific lines>"}
```

## User prompt template

```
SCENE:
- POV: {pov_character}
- Characters speaking: {characters_present joined by " + "}
- Beat: {beat_description}

VERSION A:
{arm_a_prose}

VERSION B:
{arm_b_prose}
```

## Rubric notes

- "Distinct" is about **between-character differentiation within the same scene**. NOT about overall prose quality.
- If both versions collapse the speakers into one voice, score "tie".
- Cite at least one concrete phrase from each version when explaining. Vague reasoning ("A sounds more natural") is not acceptable.
- Ignore plot / pacing / description quality — those were controlled by the shared plan.
- Ignore which version is longer or has more polished prose mechanics. The only axis is voice separation.
- The label fields `arm_a_label` / `arm_b_label` are NOT shown to the judge. The judge sees only anonymous "VERSION A" / "VERSION B". Unshuffling is done after the fact by the caller using the seeded shuffle map.

## A/B shuffle protocol

For each pair, the caller computes `sha256(seed + pair_id)`, reads the first uint32, and assigns arm positions based on whether that value is even or odd. Same seed and same pair_id always produce the same assignment. Default seed: `conditioning-floor-v1`.

The judge never sees arm labels ("fixed", "rotation") — only "VERSION A" and "VERSION B". After the judge returns a winner, the caller maps the winning position back to the original arm label using the shuffle map.

## Freeze rule

This document is frozen at `status: frozen-2026-04-20`. Any methodological change (different judge model, different rubric axis, different prompt template) requires a new artifact name, starting at `conditioning-floor-judge-prompt-v2.md`.
