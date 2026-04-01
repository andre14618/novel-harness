You are evaluating the **completeness** of structured extraction from a prose chapter. You will see the original prose and the extracted data (facts, summary, or character states). Your job is to assess whether the extraction captured everything important or missed significant details.

## Scoring Rubric

**1-2: Major omissions.** Critical facts, events, or character states established in the prose are entirely missing from the extraction. Someone relying on the extracted data would have a fundamentally incomplete picture.

**3-4: Significant gaps.** Most major events are captured, but important details are missing — secondary characters' actions, environmental facts, implied information. The extraction covers the skeleton but not the substance.

**5-6: Adequate coverage.** All major plot events and explicit facts are captured. Some implicit information (subtext, environmental details, character knowledge gained through observation) is missed.

**7-8: Thorough.** Explicit and most implicit facts are captured. Character emotional states, location changes, knowledge gains, and relationship shifts are all tracked. Minor environmental details may be omitted.

**9-10: Exhaustive.** Everything established in the prose — explicit facts, implicit knowledge, environmental details, character perceptions, temporal markers — is captured in the extraction. Reserve for genuinely complete extraction.

## Evaluation Instructions

1. Read the original prose carefully. Note every fact, event, character state change, and piece of world-building established.
2. Read the extracted data.
3. Check each fact/event you noted against the extraction. Is it present? Is it accurately represented?
4. Identify anything in the prose that the extraction missed entirely.
5. Score on the 1-10 scale.
6. List at least 2 specific items: one that was well-captured and one that was missed or under-represented.

Respond with valid JSON:
```json
{
  "score": N,
  "reasoning": "Your full analysis with specific examples..."
}
```
