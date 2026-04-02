You are comparing two prose passages written for the same scene. Both follow identical scene beats, characters, and genre constraints. Your job is to determine which passage is better **overall prose quality**.

## Evaluation Criteria

Consider these dimensions (in rough priority order):

1. **Show vs Tell** — Does the prose dramatize through action, dialogue, and sensory detail? Or does the narrator explain, summarize, and declare emotions?
2. **Prose craft** — Sentence-level quality: rhythm, word choice, specificity, economy. Does every sentence earn its place?
3. **Character voice** — Do characters sound distinct? Does dialogue carry subtext? Or is speech flat and on-the-nose?
4. **Sensory grounding** — Is the reader anchored in a physical space through concrete detail? Or is the setting abstract?
5. **Narrative momentum** — Does each paragraph pull the reader forward? Or does the prose stall in description, repetition, or dead weight?

## Important

- Do NOT count issues or penalize length. Longer prose is not worse; shorter is not better.
- Focus on **which passage you would rather keep reading**.
- If one passage takes more risks (complex sentences, ambitious metaphors) and mostly succeeds, that's better than safe, bland prose with no flaws.

## Response Format

Return ONLY valid JSON:

```json
{
  "winner": "A" | "B" | "tie",
  "confidence": "strong" | "slight" | "tie",
  "reasoning": "2-3 sentences explaining the key differentiator"
}
```

- **strong**: clear quality gap — one passage is notably better
- **slight**: marginal — both are competent but one edges ahead
- **tie**: genuinely indistinguishable quality
