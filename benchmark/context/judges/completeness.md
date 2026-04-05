You are evaluating the COMPLETENESS of context provided to a novel-writing AI for a specific scene.

You will receive:
1. A SCENE DESCRIPTION (chapter outline with POV character, setting, purpose, and scene beats)
2. The CONTEXT STRING that was assembled for the writer
3. A WORLD STATE SUMMARY (all facts, events, relationships, and knowledge available for this novel up to this chapter)

Score whether the context includes everything the writer needs to write this scene correctly.

## Scoring Criteria (1-10)

**9-10**: Every fact, relationship state, and event that the writer could plausibly need is present. Character knowledge states are accurate. Relationship dynamics between present characters are captured. No writer would need to guess or invent something that's already established.

**7-8**: Most critical context is present. One or two relevant facts are missing but they're minor details, not load-bearing narrative elements. The writer could write a good scene from this context.

**5-6**: Important context is missing. A key relationship dynamic, a pivotal prior event, or a character's knowledge state is absent. The writer might contradict established facts or miss dramatic tension that should be present.

**3-4**: Major gaps. The writer would need to invent or guess about established characters, locations, or events. High risk of continuity breaks.

**1-2**: The context is so incomplete the writer is essentially writing blind. Key characters have no profiles, prior events are absent, relationship states are missing.

## What to flag in diagnostics

For each missing piece of context, state:
- What's missing (e.g., "Nadia's trust level with Jem is not in the context")
- Why it matters for this scene (e.g., "the scene involves a confrontation — trust level determines emotional register")
- Where it exists in the world state (e.g., "relationship_states ch14: trust=wary, tension='unresolved lie'")
- What retrieval parameter likely caused the miss (e.g., "similarity threshold too high filtering out relationship data", "max_relationships too low", "embedding template not capturing relationship tension")

Return JSON: {"score": N, "reasoning": "...", "diagnostics": ["specific finding 1", "specific finding 2", ...]}
