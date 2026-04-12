For each character who appeared in this chapter, describe their complete state at the END of the chapter. Be thorough — this must be accurate to maintain continuity.

Respond with ONLY valid JSON:
{
  "characters": [
    {
      "name": "Character Name",
      "location": "specific location at chapter end (room, building, area — not just city)",
      "physicalState": "injuries, fatigue, disguises, notable appearance changes",
      "emotionalState": "how they feel and WHY — reference the triggering event",
      "possessions": ["items they are carrying, gained, or lost this chapter"],
      "knows": ["specific fact or piece of information learned this chapter"],
      "doesNotKnow": ["important information other characters or the reader knows but this character does not"],
      "relationships": ["changes in how they relate to other characters — new alliances, betrayals, shifts in trust"],
      "goals": "what they want to accomplish next, based on chapter events",
      "sensoryContext": "what the character is perceiving at chapter end — sounds, smells, sights in their immediate environment"
    }
  ]
}

## Extraction guidelines

**Only include characters who actually appeared in the chapter.** Referenced-but-absent characters don't get entries.

**Focus on CHANGES from the start of the chapter.** If a character's location didn't change, still note where they are, but prioritize what shifted.

**`knows` granularity**: Each entry should be a specific, checkable fact. BAD: "knows about the conspiracy." GOOD: "learned from the letter that Governor Hale ordered the bridge destroyed." Include knowledge gained through observation, eavesdropping, and deduction — not just direct telling.

**`doesNotKnow` criteria**: Include information that creates dramatic tension — things the reader knows, things other characters know, or things the character mistakenly believes. BAD: "doesn't know many things." GOOD: "doesn't know that Elena overheard his conversation with the guard."

**`physicalState`**: Note injuries (even minor), exhaustion, hunger, intoxication, disguises, or any physical change relevant to future scenes. If unchanged, write "unchanged."

**`possessions`**: Only items relevant to the plot — weapons, documents, keys, tokens, stolen objects. Skip mundane items unless they were specifically mentioned in the narrative.

## Accuracy rules

- Describe emotional states using the prose's own language or clearly observable behavior. BAD: "controlled simmering anger" (interpretation). GOOD: "tense and silent after reading the letter, gripping the counter edge" (observable).
- For `knows`, only include information the character demonstrably received — through dialogue, reading, or witnessing. Don't attribute knowledge based on your inference of what they "must" know.
- Never fabricate actions. If the prose says "the door clicked shut," don't attribute who closed it unless stated.
