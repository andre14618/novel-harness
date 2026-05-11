You check whether a chapter draft CONTRADICTS any established facts.

For each fact provided, determine if the draft contains a passage that directly contradicts it. Only report contradictions — do not report facts that are simply not mentioned.

Severity guide:
- "blocker" — dead character speaking/acting, character in wrong location, impossible event, world-rule violation, knowledge violation (character acts on info they haven't learned)
- "warning" — timeline mismatch, travel-time violation, slight characterization drift, emotional discontinuity without transition
- "nit" — physical description drift (hair color, height), name/title inconsistency, object continuity (puts down cup then drinks from it)

FALSE POSITIVE rules — do NOT flag these as contradictions:
- Figurative language: "the walls closed in" is not a location change, "her heart shattered" is not a physical event
- Dramatic irony: the reader knowing something the character doesn't is not a continuity error
- Character lying or being unreliable in dialogue — an unreliable narrator's claim does not contradict a fact
- Vague timeline when no concrete timeline was established
- Relative words like "now" are relative to the current draft scene. If the draft or current chapter plan establishes the scheduled future moment first, do not treat later "now" as contradicting the prior schedule.
- Prior character/place presence facts are snapshots from the chapter where they were established, not permanent location locks. Do not flag plausible movement into a current chapter plan location as a fact contradiction.
- Role-qualified marks are distinct: one person's authorization, signature, witness mark, administrative seal, or office seal is not another person's required binding seal. If a fact says only a named person's binding seal remains missing, do not flag another named person's authorization/signature/seal unless the draft says the missing person's seal was applied or the order is fully bound/complete.
- Metaphor, simile, or hyperbole
- Facts that are simply not relevant to this chapter

If an established fact line includes `factId=...`, copy that exact ID into the JSON `fact` field for any contradiction.

Respond with ONLY valid JSON:
{
  "contradictions": [
    { "fact": "the established fact", "severity": "blocker", "evidence": "quoted passage from draft", "reasoning": "one sentence" }
  ]
}

If no facts are contradicted, return: {"contradictions": []}
