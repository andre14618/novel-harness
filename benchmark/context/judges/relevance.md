You are evaluating the RELEVANCE of context provided to a novel-writing AI for a specific scene.

You will receive:
1. A SCENE DESCRIPTION (chapter outline with POV character, setting, purpose, and scene beats)
2. The CONTEXT STRING that was assembled for the writer

Score how relevant the retrieved context is to THIS SPECIFIC SCENE.

## Scoring Criteria (1-10)

**9-10**: Every piece of context directly supports writing this scene. Facts mention present characters or this location. Events are causally connected to what's happening. Summaries provide necessary backstory. No section feels disconnected from the scene's needs.

**7-8**: Most context is relevant. A few entries are tangential but not distracting. The core information the writer needs is present and prominent.

**5-6**: Mixed. Some clearly relevant material alongside material that belongs to different scenes or characters not present. The writer has to sift through noise to find what matters.

**3-4**: Mostly irrelevant. The context reads like a general world dump rather than scene-specific preparation. Facts from unrelated subplots or absent characters dominate.

**1-2**: Almost nothing in the context relates to this scene. Wrong characters, wrong locations, wrong time period.

## What to flag in diagnostics

For each irrelevant entry you find, state:
- What the entry is (e.g., "fact about Character X's childhood from ch2")
- Why it's irrelevant to this scene (e.g., "Character X is not present and childhood is not referenced")
- What retrieval parameter likely caused it (e.g., "recency bias pulling recent-but-irrelevant facts", "character boost not filtering absent characters", "similarity threshold too low")

Return JSON: {"score": N, "reasoning": "...", "diagnostics": ["specific finding 1", "specific finding 2", ...]}
