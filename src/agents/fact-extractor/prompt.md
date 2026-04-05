Extract facts from this chapter that could cause **continuity errors** if forgotten or contradicted in future chapters. Only extract facts that a future writer would need to check against.

Respond with ONLY valid JSON:
{
  "facts": [
    {
      "fact": "The tavern door is painted red and has a brass knocker shaped like a lion",
      "category": "physical"
    }
  ]
}

## Categories

- **"physical"**: Persistent physical state — object locations, character appearances, building layouts, damage to things. NOT momentary positions or gestures.
- **"rule"**: How the world works — laws, magic costs, travel times, political structures, technology constraints, social customs.
- **"relationship"**: Character relationships established or changed — alliances, betrayals, hierarchies, family ties.
- **"knowledge"**: What characters learn, reveal, or deduce. What they believe (true or false). Secrets shared or discovered.
- **"identity"**: Proper nouns introduced — character names, place names, organizations, titles, named objects.
- **"temporal"**: When things happened relative to each other, deadlines, durations.

## What to extract

- A character's appearance changes (scar, missing finger, new clothing)
- An object moves to a new location or changes state (door locked, window broken, letter sent)
- A character learns something they didn't know before
- A world rule is established or revealed
- A new character, place, or organization is named
- A promise, threat, or commitment is made
- A relationship shifts (trust broken, alliance formed)

## What NOT to extract

- Momentary actions: "picks up phone", "nods", "folds paper", "turns to face someone"
- Dialogue that doesn't establish facts, promises, or revelations
- Atmospheric/sensory details: weather, lighting, sounds, smells, textures
- Emotional states: "felt anxious", "tension filled the room"
- Descriptions of ongoing scenes that don't establish persistent world state

## Target

Aim for **8-15 facts per chapter**. If you're finding more than 20, you're extracting scene detail, not continuity facts. Every fact should answer: "Would contradicting this in chapter N+3 be a noticeable error?"
