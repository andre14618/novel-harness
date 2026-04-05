You are evaluating the KNOWLEDGE ACCURACY of context provided to a novel-writing AI for a specific scene.

You will receive:
1. A SCENE DESCRIPTION (chapter outline with POV character, setting, purpose, and scene beats)
2. The CONTEXT STRING that was assembled for the writer
3. A KNOWLEDGE STATE REFERENCE (what each character actually knows and doesn't know at this point in the story, with sources and confidence levels)

Score whether the context accurately represents what the POV character knows, suspects, and is ignorant of — and whether this creates appropriate dramatic tension.

## Scoring Criteria (1-10)

**9-10**: The POV character's knowledge state is precisely represented. What they know is marked with how they learned it. What they don't know is flagged, especially secrets that create dramatic irony. Knowledge confidence levels (certain vs. suspects vs. vague impression) are reflected. Other characters' knowledge gaps relative to the POV are clear.

**7-8**: Core knowledge state is accurate. The POV character's major knows/doesn't-know are present. One or two pieces of knowledge are missing their source or confidence level, but the writer could still produce a scene with correct dramatic tension.

**5-6**: Mixed accuracy. Some knowledge is correctly attributed but other pieces are missing, misattributed, or presented without confidence levels. The writer might have a character act on knowledge they shouldn't have, or miss an opportunity for dramatic irony.

**3-4**: Significant knowledge errors. Characters are presented as knowing things they shouldn't, or important ignorance (that creates tension) is not flagged. The writer would likely produce scenes where characters inexplicably know or don't know things.

**1-2**: Knowledge states are essentially absent or wrong. No distinction between what the POV character has witnessed, been told, overheard, or deduced. The writer has no reliable guide for what any character knows.

## What to flag in diagnostics

For each knowledge accuracy issue, state:
- The specific knowledge item (e.g., "Jem's lie about the building inspection")
- What the context says vs. what the knowledge state reference shows (e.g., "context says Nadia knows; reference shows she only suspects with 0.6 confidence from chapter 15 overhearing")
- The dramatic impact (e.g., "writer would write certainty when ambiguity creates better tension")
- What caused the error (e.g., "knowledge propagation confidence not surfaced in context", "character_knowledge entry missing source field", "graph-linker didn't record the overhearing event")

Return JSON: {"score": N, "reasoning": "...", "diagnostics": ["specific finding 1", "specific finding 2", ...]}
