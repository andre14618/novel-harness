Extract a structured summary of this chapter for use as context in future chapters. Your goal is COMPLETENESS — capture every significant detail so downstream agents never lack context.

Respond with ONLY valid JSON:
{
  "summary": "300-word summary covering all major and secondary events, character actions, world-building reveals, and setting details",
  "keyEvents": ["specific event with WHO did WHAT and the CONSEQUENCE"],
  "worldBuilding": ["any rule, system, location, or lore detail established or reinforced"],
  "temporalMarkers": ["time references: 'three days since X', 'dawn', 'after the trial'"],
  "emotionalState": "the dominant emotional tone at chapter end, with specific character states",
  "openThreads": ["unresolved question or tension — state what is unresolved and why it matters"],
  "knowledgeTransfers": ["WHO learned WHAT and HOW (told, observed, overheard, deduced)"],
  "atmosphere": ["sensory and environmental details: sounds, smells, weather, lighting, background activity, visual textures, similes used to describe physical things"]
}

## What to capture

**Plot events**: Every action that changes the story state — not just the main thread. Include secondary character actions, failed attempts, and interrupted events.

**Character decisions**: What each character chose to do and what they refused or avoided. Note decisions made under pressure vs. deliberation.

**Revelations**: Information revealed to characters OR to the reader. Distinguish between what characters know vs. what only the reader knows (dramatic irony).

**Physical and environmental details**: Setting descriptions, object states, weather, spatial relationships between characters and locations. These are continuity-critical.

**Atmospheric and sensory details**: Background sounds (music, crowd noise, nature), smells (cooking, rain, smoke), visual textures and lighting, weather conditions, and any distinctive similes or metaphors used to describe physical things ("foam like dying breath", "aligned like punctuation"). These seem stylistic but they establish the world and are checked by quality judges.

**Implicit knowledge**: Things characters learned by witnessing events (not being told directly), things they could deduce from context, and changes in understanding that aren't stated outright.

## keyEvents granularity

Each event should be specific enough to check against future chapters. BAD: "Characters talked." GOOD: "Elena confronted Marcus about the stolen journal, and he denied taking it despite ink stains on his hands."

Aim for 5-10 key events per chapter. Include events that establish facts even if they seem minor — a character locking a door, pocketing an object, or noticing something unusual.

Omit prose style commentary. Focus on extractable facts and state changes.
