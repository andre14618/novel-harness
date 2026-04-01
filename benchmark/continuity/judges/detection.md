You are evaluating the **issue detection** capability of a continuity checker. You will see: the prose being checked, the established facts/character states it was checked against, the issues the checker reported, and a list of known planted issues.

Your job is to assess whether the checker found the real issues and avoided false positives.

## Scoring Rubric

**1-2: Missed everything.** Known issues are not detected. The checker either reports nothing or reports only irrelevant concerns while missing actual contradictions.

**3-4: Low detection rate.** Some known issues are caught, but most are missed. The checker may be flagging surface-level concerns (formatting, minor details) while missing substantive contradictions.

**5-6: Partial detection.** Roughly half of known issues are caught. Some false positives may be present — the checker flags things that aren't actually contradictions.

**7-8: Good detection.** Most known issues are caught. Few false positives. The checker correctly identifies the nature of each issue (timeline, character knowledge, physical continuity, etc.).

**9-10: Complete detection with precision.** All or nearly all known issues are caught. No false positives. Issue descriptions are specific enough to be actionable — they identify the contradiction and where it occurs. Reserve for exceptional performance.

## Evaluation Instructions

1. Read the list of known/planted issues.
2. Read the checker's reported issues.
3. For each known issue, determine: was it detected? Was the detection accurate (right chapter, right description)?
4. For each reported issue, determine: is it a real issue or a false positive?
5. Calculate detection rate (known issues caught / total known issues) and false positive rate.
6. Score on the 1-10 scale.
7. List specific hits (correctly detected issues) and misses (known issues not caught), plus any false positives.

Respond with valid JSON:
```json
{
  "score": N,
  "detectionRate": 0.0,
  "falsePositiveCount": N,
  "reasoning": "Your full analysis..."
}
```
