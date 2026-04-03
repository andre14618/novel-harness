Extract every concrete, specific fact established in this chapter that could be contradicted in future chapters. Be exhaustive — missed facts cause continuity errors downstream.

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

- **"physical"**: Descriptions of places, objects, character appearances. Includes architectural features, spatial layout, environmental conditions (weather, lighting, sounds, smells), and the physical state of objects (locked, broken, open).
- **"sensory"**: How things feel, smell, sound, taste. Textures (gritty sand, smooth stone), sounds (groaning, whispers, resonance), smells (ozone, dust). These are often missed but continuity-critical.
- **"action"**: Physical interactions with the environment — pressing seals, turning keys, lifting objects, throwing items, locking doors. Include ritual components: exact commands spoken, gestures, material components used.
- **"rule"**: How the world works — travel times, magic costs, political structures, technology constraints, social customs. Include measurement units and time durations.
- **"relationship"**: Character relationships established or changed — alliances, betrayals, hierarchies, family ties, romantic developments.
- **"knowledge"**: What characters learn, reveal, or deduce. Include information gained through observation or eavesdropping (not just direct telling). Note when a character learns something the reader already knew.
- **"identity"**: Every proper noun — character names (including dead/absent ones), place names, organization names, titles, named objects or artifacts.
- **"dialogue"**: Exact phrases spoken that establish facts, promises, threats, commands, or revelations. Include interrupted speech and significant lies.

## Extraction rules

1. Extract SPECIFIC and CONCRETE facts. "The door was red" not "the building was described."
2. One fact per entry. Split compound facts into separate entries.
3. Include facts that seem minor — a character pocketing a key, noticing a scar, glancing at a clock. These create continuity traps.
4. Extract what characters physically do with their hands and bodies.
5. Extract visual symbols: glyphs, patterns, murals, crests, tattoos.
6. Extract temporal facts: how long something took, when events happened relative to each other.
7. When a fact is implied rather than stated directly, still extract it but note the inference: "Marcus appears to already know about the fire (doesn't react to the news)."
8. Extract ATMOSPHERIC details — background sounds (fiddles, crowd noise), smells (cooking, rain), visual textures, lighting conditions, weather. These seem stylistic but they establish the world and get checked by completeness judges.
9. Extract distinctive similes and metaphors describing physical things ("foam like dying breath", "aligned like punctuation") as sensory facts.

Aim for 20-35 facts per chapter. If you're finding fewer than 20, you're being too selective.

## Accuracy rules

- Every fact must map to a specific passage in the prose. Do not synthesize or editorialize.
- BAD: "The health inspector officially recognized their partnership" (interpretation of him smiling and taking a photo).
- GOOD: "The health inspector took a photo of their shared prep station and smiled."
- If a fact requires inference, use the knowledge category and prefix with "Implied:" — e.g., "Implied: Marcus already knew about the fire (no visible reaction when told)."
- Never add causal claims not in the text. "The door clicked shut" is a fact. "Nadia slammed the door shut" is only a fact if the prose says she did.
