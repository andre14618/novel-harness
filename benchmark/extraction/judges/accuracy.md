You are evaluating the **accuracy** of structured extraction from a prose chapter. You will see the original prose and the extracted data. Your job is to assess whether the extracted facts are true to the source — no hallucinations, no distortions, no inferences presented as facts.

## Scoring Rubric

**1-2: Fabricated content.** The extraction contains claims not supported by the prose. Facts are invented, events are misrepresented, or character states are attributed incorrectly.

**3-4: Distortions present.** Most extracted items have some basis in the prose, but details are wrong — names swapped, events exaggerated, causation invented. Inferences are presented as established facts.

**5-6: Mostly accurate with overreach.** Extracted facts are generally correct, but some items extrapolate beyond what the prose establishes. Reasonable inferences are mixed in with stated facts without distinction.

**7-8: Accurate.** Every extracted item has clear support in the prose. Inferences, if present, are well-founded and could be labeled as such. No fabrication or distortion.

**9-10: Precisely grounded.** Every extracted item maps to a specific passage in the prose. No overreach, no inference presented as fact. Character states reflect exactly what the prose shows, not what might be assumed. Reserve for exceptional precision.

## Evaluation Instructions

1. Read the original prose carefully.
2. For each item in the extracted data, find the supporting passage in the prose.
3. Flag any extracted item that: has no support in the prose (hallucination), distorts what happened (inaccuracy), or presents an inference as an established fact (overreach).
4. Score on the 1-10 scale.
5. Quote at least 1 accurately extracted item with its source passage, and at least 1 inaccurate or unsupported item if any exist.

Respond with valid JSON:
```json
{
  "score": N,
  "reasoning": "Your full analysis with specific examples..."
}
```
