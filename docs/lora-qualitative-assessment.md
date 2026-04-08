# LoRA v3 Qualitative Assessment: Does It Sound More Human?

**Date**: 2026-04-06
**Evaluator**: Claude Opus (reading as a prose editor, not measuring metrics)
**Method**: 15 paragraphs rewritten by base Qwen 3.5 9B and V3 LoRA, blind-read and scored on: (1) does it sound like a human wrote it, (2) are there AI tells, (3) which would you keep in a novel draft.

---

## Per-Paragraph Verdicts

### P1: Soldier in corridor
- **BASE**: "Strange, wet sounds echoed from the ruins' depths, while the air bit at his skin, cold and damp. Unease prickled his nerves, but he pressed on, driven forward despite the dread."
- **V3**: "Strange, guttural sounds echoed from the ruins' depths, while the air bit at his skin with a chilling dampness. Unease prickled his nerves, but he forced his feet forward anyway."
- **Verdict: V3 slightly better.** "Guttural" is a more specific and physical word than "wet." "Forced his feet forward anyway" has a blunt quality that feels more human than "pressed on, driven forward despite the dread" — the base version stacks two clauses that say the same thing.
- **AI tells in both**: "Unease prickled his nerves" is a cliché either way. A human writer would probably cut that sentence entirely and show the unease through action.

### P2: Sword fight in rain
- **BASE**: "It grazed the steel, sparks dying instantly. Both men heaved for air, their chests rising and falling in a ragged rhythm, neither showing the slightest sign of yielding."
- **V3**: "The steel grated against the guard, barely missed, sending sparks flying. Both men gasped, chests heaving, refusing to yield an inch."
- **Verdict: V3 clearly better.** "Both men gasped, chests heaving, refusing to yield an inch" is tighter and more muscular than the base's "their chests rising and falling in a ragged rhythm" — the base version describes the breathing in slow motion, which kills the fight's momentum. V3 maintains tempo.
- **AI tells**: "refusing to yield an inch" is slightly formulaic but not a flagrant tell. The base's "neither showing the slightest sign of yielding" is worse — the "slightest sign of" construction is hedging language.

### P3: Battle aftermath
- **BASE**: "Sunlight glared off the churned mud, where hundreds of bodies lay tangled, silent, and cold."
- **V3**: "For hours, the mud had churned into a red slurry, littered with the broken limbs and quiet faces of the dead. The defenders, their limbs heavy with exhaustion, planted their boots deep in the churned earth and refused to blink."
- **Verdict: V3 wins by a wide margin.** "The broken limbs and quiet faces of the dead" is concrete, specific, and human. "Planted their boots deep in the churned earth and refused to blink" is a physical image that conveys stubbornness through action, not abstraction. The base's "Sunlight glared" is a cliché opener, and "silent, and cold" is a tell-don't-show list.
- **V3's last line**: "He did not fall; he roared, anchoring them." — this is genuinely good prose. Short declarative sentence followed by a participial phrase. The semicolon is used correctly for dramatic effect. A human editor would keep this.

### P4: Fighting a beast
- **BASE**: "Steel sang as he drew the blade, then he lunged."
- **V3**: "He drew his steel and lunged."
- **Verdict: V3 wins.** "He drew his steel and lunged" is Howard-grade economy. The base's "Steel sang as he drew the blade" is ornamental — steel doesn't sing when you draw it from a scabbard, that's a fantasy cliché. V3 just does the action. The rest of V3 is also tighter: "slicing deep into the soft, pulsing flesh of its exposed throat" is visceral and specific.
- **AI tells in base**: "Massive claws raked the air, missing him by inches as he dove sideways" — "missing him by inches" is stock phrase.

### P5: Tower stairs
- **BASE**: "Fear tugged at her heels, screaming to turn back, but the unknown rhythm pulled her forward anyway."
- **V3**: "Yet curiosity clawed at her ribs, pulling her forward into the dark."
- **Verdict: Tie, both have problems.** Base personifies fear ("Fear tugged at her heels, screaming") — that's narrator editorializing, an AI pattern. V3 personifies curiosity ("curiosity clawed at her ribs") — same sin, slightly more physical. Neither is great. A human writer would show her taking another step despite herself, not narrate the internal tug-of-war.

### P6: Abandoned castle
- **BASE**: "Yet the silence held a strange tension. Fresh scuff marks sliced through the thick layer of gray dust on the floorboards, proving that despite the rot and the ruin, something—or someone—had just walked through."
- **V3**: "Yet the air hummed with a strange, waiting life. Fresh scuff marks tore through the thick gray dust, proving the empty halls were not so empty after all."
- **Verdict: V3 clearly better.** V3 is 40 words to base's 65. "Not so empty after all" is punchier than the base's "despite the rot and the ruin, something—or someone—had just walked through" — the base over-explains with the parenthetical and the two nouns. V3 also has "Vines strangled the courtyard walls" vs base's "Vines choked the courtyard, snapping through fissures where moss had taken root" — V3 does in 5 words what base does in 12.
- **Most human-sounding line across both versions**: V3's "shattered glass littered the floor like white bone" — specific, visual, unexpected comparison.

### P7: Swamp
- **BASE**: "A funeral shroud of mist clung to the surface, while ghostly lights pulsed like diseased eyes in the gloom."
- **V3**: "A heavy mist clung to the surface, while eerie lights flickered in the gloom like dying embers."
- **Verdict: Base overreaches, V3 is safer.** "Funeral shroud of mist" and "ghostly lights pulsed like diseased eyes" — the base is trying too hard. Two metaphors in one sentence, both ornate. V3's "dying embers" is a simpler, more natural comparison. Neither is great — a human writer would probably use one metaphor per paragraph, not per sentence.
- **AI tell in both**: Both versions are metaphor-heavy in a way that signals "I'm trying to write atmospheric prose." Human writers in this genre use more concrete nouns and fewer similes.

### P8: Quiet city
- **BASE**: "Only a handful of torches flickered along the main street, drowning the cobblestones in pools of oily orange. Ahead, a cat bolted across the road, vanishing instantly into a throat of darkness."
- **V3**: "Along the main street, embers in torches flickered, spilling pools of orange onto the cobblestones. Ahead, a cat darted across the road, vanishing instantly into a dark, narrow alley."
- **Verdict: BASE wins this one.** "A throat of darkness" is a more original and evocative image than V3's literal "a dark, narrow alley." The base's "oily orange" is also more specific than V3's plain "orange." V3 plays it too safe here — it flattened out the interesting bits.
- **This reveals a V3 weakness**: the LoRA sometimes removes distinctive language along with ornamental language. It can't always distinguish between "ornate AI prose" and "genuinely good writing."

### P9: Woman on cliff
- **BASE**: "Perched on the cliff's razor edge, she stared down into the churning abyss where the sea clawed at the rocks."
- **V3**: "She stood on the cliff's precipice, staring into the churning abyss below."
- **Verdict: BASE is more vivid, V3 is more economical.** "The sea clawed at the rocks" is a strong image the base produced. V3 cut it for economy but lost something. However, V3's closing — "she had come to make a choice she knew would seal her fate, leaving no path for retreat" — is cleaner than the base's "a single step forward meant no return" which is more cliché.
- **Tie overall.** Different tradeoffs.

### P10: Waking bound
- **BASE**: "Consciousness returned not with clarity, but with a violent throb behind his eyes."
- **V3**: "Darkness swallowed him whole. He woke with a thunderous headache splitting his skull, his wrists seared by rough hemp rope."
- **Verdict: V3 better.** "Darkness swallowed him whole" is a strong opener — short, physical. "Thunderous headache splitting his skull" is overwrought but at least concrete. Base's "Consciousness returned not with clarity, but with a violent throb" is a narrator-editorializaing construction — "not X, but Y" is an essayistic move, not fiction.
- **Both have AI tells**: "suffocating darkness/gloom" appears in both — it's one of the most common AI prose words.

### P11: Dawn on battlefield
- **BASE**: "In the biting cold, the victory tasted like ash."
- **V3**: "In the biting cold, victory tasted like ash."
- **Verdict: Nearly identical closing.** But V3's opener is stronger: "Dawn cracked open the battlefield, bleaching the mud in sickly gray light" vs base's "Gray dawn bled across the churned earth." V3's "cracked open" is more physical and violent, which suits the subject. "Bleaching the mud" is concrete. Base's "bled across" is a more common metaphor.
- **V3 has the best phrase**: "a carpet of corpses" — dark, alliterative, efficient.

### P12: Tavern
- **BASE**: "The noise swallowed him whole, granting him the perfect, invisible cloak he craved."
- **V3**: "The noise washed over him, but no one saw him; that invisibility was precisely his aim."
- **Verdict: BASE better here.** "The noise swallowed him whole, granting him the perfect, invisible cloak he craved" is a more unified image. V3's "that invisibility was precisely his aim" is explanatory and slightly clinical — it tells instead of shows.

### P13: Old man staring
- **BASE**: "Despite his age, his eyes remained sharp as flint, dissecting the younger man's face with an unsettling precision. Finally, he slumped back in his chair, the creak of the wood echoing in the silence."
- **V3**: "Something primal and unsettling coiled in the way he dissected the younger man's features, peeling back layers until nothing remained but raw nerve. Only then did he slump back, exhaling a ragged, rattling breath that seemed to carry the weight of a lifetime."
- **Verdict: V3 overreaches here.** "Peeling back layers until nothing remained but raw nerve" is theatrical. "A ragged, rattling breath that seemed to carry the weight of a lifetime" is an AI cliché — "the weight of" is literally on our lint list. Base is more restrained and actually better for it. The chair creak is a nice concrete detail the V3 lost.
- **Lesson**: V3 sometimes amplifies when it should restrain. The LoRA learned "be vivid" but not "know when to be quiet."

### P14: Ship in storm
- **BASE**: "The ship heaved like a dying beast as the storm intensified."
- **V3**: "The ship heaved violently, tossed by a tempest that clawed at the sky."
- **Verdict: BASE slightly better.** "Like a dying beast" is a more specific and physical simile than V3's "that clawed at the sky" which personifies the storm in a vague way. Both are acceptable. V3 is wordier here (67 vs 60), which goes against the general trend.

### P15: Assassin on rooftop
- **BASE**: "The window to strike would snap shut in a heartbeat."
- **V3**: "The window to act was razor-thin."
- **Verdict: V3 better.** "Razor-thin" is more precise and physical than "snap shut in a heartbeat" which mixes the metaphor (windows don't snap). V3's "She counted their paces, mapped their blind spots, and timed her strike" is cleaner than base's "She weighed them in her mind, mapping every step, measuring the cracks in her plan" — the base uses three gerunds in a row, which is a rhythmic tell.

---

## Scorecard

| Paragraph | Winner | Margin | Notes |
|-----------|--------|--------|-------|
| P1: Corridor | V3 | Slight | More specific word choices |
| P2: Sword fight | V3 | Clear | Better tempo, tighter |
| P3: Battle | V3 | **Strong** | Best V3 paragraph. "He did not fall; he roared, anchoring them." |
| P4: Beast fight | V3 | Clear | "He drew his steel and lunged." — Howard-grade economy |
| P5: Tower stairs | Tie | — | Both personify emotions (AI tell) |
| P6: Castle | V3 | Clear | 40% fewer words, stronger images |
| P7: Swamp | V3 | Slight | Less overwrought metaphors |
| P8: City night | BASE | Slight | "A throat of darkness" — V3 flattened the good parts |
| P9: Cliff | Tie | — | Different strengths |
| P10: Waking bound | V3 | Slight | Stronger opener |
| P11: Dawn battlefield | V3 | Slight | "A carpet of corpses" |
| P12: Tavern | BASE | Slight | V3 got explanatory |
| P13: Old man | Tie | — | "weight of a lifetime" reads well in context despite being a lint-flagged pattern; base's chair creak is a nice concrete detail V3 lost |
| P14: Storm ship | BASE | Slight | V3 got wordier, less specific simile |
| P15: Assassin | V3 | Slight | Cleaner action, no mixed metaphor |

**Final tally: V3 wins 9, BASE wins 2, Tie 4.**

---

## Honest Assessment

**V3 is better prose than base about 60% of the time.** Its wins are most convincing on action sequences (P2, P3, P4) where the compression and directness produce genuinely good writing. P3's "He did not fall; he roared, anchoring them" and P4's "He drew his steel and lunged" are lines a human editor would keep.

**V3 occasionally overreaches** — adding theatrical flourishes where base is more restrained. However, the initial assessment overcounted this. P13's "the weight of a lifetime" reads well in full context (an ancient man exhaling after a searching stare) despite being a lint-flagged pattern. This suggests the lint system has a false positive problem: it flags patterns by surface match without reading context. Some flagged patterns are earning their place. Worth auditing the lint rules against published human fiction to measure false positive rate.

**V3's other failure mode is over-flattening.** In P8, it replaced "a throat of darkness" (a good, original image) with "a dark, narrow alley" (literal and boring). The LoRA sometimes can't distinguish between "ornate AI prose to cut" and "genuinely good writing to keep."

**Both models still sound like AI**, just different flavors. Base sounds like "competent AI trying to be literary." V3 sounds like "competent AI that read a lot of pulp fiction." Neither sounds like a human writer yet. The biggest remaining tells: over-reliance on "suffocating" as a darkness adjective, personifying abstract concepts (fear tugged, curiosity clawed, silence swallowed), and stacking metaphors.

**The real value of V3 in production** would be as a first pass that tightens prose and strips unnecessary adjectives, followed by the deterministic lint pass to catch the remaining AI clichés it introduces. It's not a replacement for good writing — it's a compression and directness filter.

---

## Recommendations for V4

1. **Add negative examples to training.** V3 sometimes produces the exact clichés our lint system catches ("the weight of", "suffocating darkness"). If we can identify these in the training outputs and penalize them via DPO, the model would learn to avoid them.

2. **Include "leave it alone" examples.** V3 sometimes changes good prose into worse prose (P8). The training data needs examples where the input is already strong and the correct output is minimal change. This teaches the model restraint.

3. **Scene-type conditioning.** V3 performs best on action, worst on introspection. The system prompt could include a scene-type tag ("ACTION:", "ATMOSPHERE:", "CHARACTER:") so the model learns different rewriting strategies per type.

4. **Run through our own lint system post-rewrite.** Measure how many lint violations V3 introduces vs base. If V3 introduces fewer, that's a concrete production metric beyond subjective prose quality.
