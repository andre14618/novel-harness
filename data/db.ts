/**
 * Central operational database.
 *
 * Single source of truth for all LLM calls, run configs, model assignments,
 * benchmark scores, AND all per-novel creative content (drafts, outlines, facts,
 * world state, knowledge graph). Everything lives in one Postgres DB.
 */

import db from "./connection"
import { AGENT_MODELS, type ModelAssignment } from "../models/roles"

/** Backward-compat shim — callers that still call getCentralDB() get the connection object. */
export function getCentralDB() {
  return db
}

// ── Lint pattern seeding ─────────────────────────────────────────────────

async function seedLintPatterns() {
  const [tier1Row] = await db`SELECT COUNT(*) as c FROM lint_patterns WHERE tier = 1`
  if ((tier1Row as any).c > 0) {
    // Tier 1 already seeded — just check Tier 2, 3, and AI tells
    await seedTier2Patterns()
    await seedTier3Patterns()
    await seedAITellPatterns()
    return
  }

  const patterns: [number, string, string, string, string, boolean, string, string | null][] = [
    // ── Tier 1: Filler phrases ───────────────────────────────────
    [1, "FILLER_PHRASE", "\\b(began|started|continued|proceeded)\\s+to\\s+\\w+", "gi",
      "Remove the revving-up verb — write the action directly.", false,
      "Revving-up verbs add a layer of indirection. 'She began to run' is weaker than 'She ran.' The action itself is what matters.",
      "Gradual-onset actions like 'began to blur' or 'began to ring' may be intentional — the rewriter should judge whether the onset is meaningful. Natural in dialogue."],

    [1, "FILLER_PHRASE", "\\bin order to\\b", "gi",
      "Replace with 'to'.", true,
      "Always replaceable with 'to' — adds words without meaning.",
      null],

    [1, "FILLER_PHRASE", "\\bthe fact that\\b", "gi",
      "Cut 'the fact that' — rephrase the clause directly.", false,
      "Nominalization that bloats sentences. 'Despite the fact that' → 'Although'. 'Aware of the fact that' → 'Aware that'. Natural in dialogue — skip in speech.",
      null],

    [1, "FILLER_PHRASE", "\\bdue to the fact that\\b", "gi",
      "Replace with 'because'.", true,
      "Five words that always mean 'because'.",
      null],

    [1, "FILLER_PHRASE", "\\bin spite of the fact that\\b", "gi",
      "Replace with 'although' or 'despite'.", true,
      "Six words that always mean 'although'.",
      null],

    [1, "FILLER_PHRASE", "\\bat this point in time\\b", "gi",
      "Replace with 'now'.", true,
      "Five words that always mean 'now'.",
      null],

    [1, "FILLER_PHRASE", "\\bfor the purpose of\\b", "gi",
      "Replace with 'to' or 'for'.", true,
      "Four words that always mean 'to' or 'for'.",
      null],

    [1, "FILLER_PHRASE", "\\bhas the ability to\\b", "gi",
      "Replace with 'can'.", true,
      "Four words that always mean 'can'.",
      null],

    // ── Tier 1: Redundant body language ──────────────────────────
    [1, "REDUNDANT_BODY", "\\bnodded\\s+(his|her|their)\\s+head", "gi",
      "Remove redundant body part — 'nodded' is sufficient.", false,
      "You can only nod your head. The body part adds nothing.",
      null],

    [1, "REDUNDANT_BODY", "\\bshrugged\\s+(his|her|their)\\s+shoulders", "gi",
      "Remove redundant body part — 'shrugged' is sufficient.", false,
      "You can only shrug your shoulders. The body part adds nothing.",
      null],

    [1, "REDUNDANT_BODY", "\\bblinked\\s+(his|her|their)\\s+eyes", "gi",
      "Remove redundant body part — 'blinked' is sufficient.", false,
      "You can only blink your eyes. The body part adds nothing.",
      null],

    [1, "REDUNDANT_BODY", "\\bclenched\\s+(his|her|their)\\s+fists", "gi",
      "'clenched' already implies fists unless the body part disambiguates or sets up a subsequent detail.", false,
      "Clenching defaults to fists. But sometimes 'fists' sets up a follow-on detail ('clenched her fists, nails digging into palms').",
      "When 'fists' is load-bearing for a subsequent detail, the rewriter should keep it."],

    [1, "REDUNDANT_BODY", "\\bsat\\s+down\\b", "gi",
      "Remove 'down' — 'sat' implies downward.", false,
      "Sitting is inherently downward. 'Down' adds nothing.",
      null],

    [1, "REDUNDANT_BODY", "\\b(?:she|he|they|I|we)\\s+stood\\s+up\\b", "gi",
      "Remove 'up' — 'stood' implies upward.", false,
      "Standing is inherently upward. 'Up' adds nothing.",
      "Must have a person subject — 'hair stood up' is a different meaning."],

    [1, "REDUNDANT_BODY", "\\breturned\\s+back\\b", "gi",
      "Remove 'back' — 'returned' already means going back.", false,
      "Returning is inherently backward.",
      null],

    [1, "REDUNDANT_BODY", "\\brose\\s+up\\b", "gi",
      "Remove 'up' — 'rose' implies upward.", false,
      "Rising is inherently upward.",
      null],

    // ── Tier 1: Redundant adverb + verb ──────────────────────────
    [1, "REDUNDANT_ADVERB_VERB", "\\bwhispered\\s+softly\\b", "gi",
      "Remove 'softly' — whispering is inherently soft.", false,
      "The adverb restates what the verb already communicates.",
      null],

    [1, "REDUNDANT_ADVERB_VERB", "\\bshouted\\s+loudly\\b", "gi",
      "Remove 'loudly' — shouting is inherently loud.", false,
      "The adverb restates what the verb already communicates.",
      null],

    [1, "REDUNDANT_ADVERB_VERB", "\\bscreamed\\s+loudly\\b", "gi",
      "Remove 'loudly' — screaming is inherently loud.", false,
      "The adverb restates what the verb already communicates.",
      null],

    [1, "REDUNDANT_ADVERB_VERB", "\\bmurmured\\s+softly\\b", "gi",
      "Remove 'softly' — murmuring is inherently soft.", false,
      "The adverb restates what the verb already communicates.",
      null],

    [1, "REDUNDANT_ADVERB_VERB", "\\bcrept\\s+quietly\\b", "gi",
      "Remove 'quietly' — creeping implies stealth.", false,
      "The adverb restates what the verb already communicates.",
      null],

    [1, "REDUNDANT_ADVERB_VERB", "\\bstrolled\\s+leisurely\\b", "gi",
      "Remove 'leisurely' — strolling implies a leisurely pace.", false,
      "The adverb restates what the verb already communicates.",
      null],

    [1, "REDUNDANT_ADVERB_VERB", "\\bgripped\\s+firmly\\b", "gi",
      "Remove 'firmly' — gripping implies firmness.", false,
      "The adverb restates what the verb already communicates.",
      null],

    [1, "REDUNDANT_ADVERB_VERB", "\\brushed\\s+quickly\\b", "gi",
      "Remove 'quickly' — rushing implies speed.", false,
      "The adverb restates what the verb already communicates.",
      null],

    [1, "REDUNDANT_ADVERB_VERB", "\\bhurried\\s+quickly\\b", "gi",
      "Remove 'quickly' — hurrying implies speed.", false,
      "The adverb restates what the verb already communicates.",
      null],

    // ── Tier 1: Empty transitions ────────────────────────────────
    [1, "EMPTY_TRANSITION", "(?:^|(?<=\\.\\s{1,2}))And then\\b", "gm",
      "Cut 'And then' — start with the action.", false,
      "Empty connector that delays the action. The reader already knows events are sequential.",
      "Occasionally used as a deliberate dramatic beat — the rewriter should judge."],

    [1, "EMPTY_TRANSITION", "(?:^|(?<=\\.\\s{1,2}))After that\\b", "gm",
      "Cut 'After that' — start with the action.", false,
      "Empty connector that delays the action.",
      null],

    [1, "EMPTY_TRANSITION", "(?:^|(?<=\\.\\s{1,2}))All of a sudden\\b", "gm",
      "Cut 'All of a sudden' — just describe what happened.", false,
      "Telling the reader something is sudden instead of making the prose feel sudden through pacing.",
      null],
  ]

  for (const [tier, category, pattern, flags, fix_template, dialogue_ok, rationale, edge_cases] of patterns) {
    await db`
      INSERT INTO lint_patterns (tier, category, pattern, flags, fix_template, dialogue_ok, rationale, edge_cases)
      VALUES (${tier}, ${category}, ${pattern}, ${flags}, ${fix_template}, ${dialogue_ok}, ${rationale}, ${edge_cases})
    `
  }

  await seedTier2Patterns()
  await seedTier3Patterns()
  await seedAITellPatterns()
}

async function seedTier2Patterns() {
  const [tier2Row] = await db`SELECT COUNT(*) as c FROM lint_patterns WHERE tier = 2`
  if ((tier2Row as any).c > 0) return

  const patterns: [number, string, string, string, string, boolean, string, string | null][] = [
    // ── Tier 2: Filter words (narrator distancing) ──────────────
    [2, "FILTER_WORD", "\\bseemed\\s+to\\b", "gi",
      "Remove distancing — describe the action or sensation directly.", false,
      "'Seemed to' adds a narrator hedge between the reader and the experience. 'The rain seemed to pause' → 'The rain paused.' The POV character observes, not the narrator.",
      "Legitimate in genuinely uncertain perception: 'He seemed to recognize her' (POV character is unsure). In dialogue, natural hedging — skip."],

    [2, "FILTER_WORD", "\\bcould\\s+feel\\b", "gi",
      "Remove 'could feel' — describe the sensation directly.", false,
      "'She could feel the cold' filters through ability ('could') instead of experience. 'The cold bit her fingers' or 'Her skin prickled' is direct perception.",
      "In dialogue, natural phrasing — skip. 'Could feel' before abstract nouns ('could feel the tension') may need more than just cutting the filter."],

    [2, "FILTER_WORD", "\\bcould\\s+see\\b", "gi",
      "Remove 'could see' — describe what is seen directly.", false,
      "'She could see the tower' filters through ability. 'The tower rose' or 'The tower stood at the far end' is direct perception. The POV character's senses report — they don't narrate their own noticing.",
      "Exception: emphasis on ability or constraint ('From here she could see the whole valley' — the vantage point matters). In dialogue, skip."],

    [2, "FILTER_WORD", "\\bcould\\s+hear\\b", "gi",
      "Remove 'could hear' — describe the sound directly.", false,
      "'She could hear boots on stone' → 'Boots scraped against stone.' Direct perception is always stronger.",
      "Exception: emphasis on distance or effort ('She could barely hear him'). In dialogue, skip."],

    [2, "FILTER_WORD", "\\bfound\\s+(herself|himself|themselves|itself)\\b", "gi",
      "Remove 'found herself' — describe the action directly.", false,
      "'She found herself staring' → 'She stared.' The 'found' construction implies surprise at one's own action, but is almost always just a distancing habit.",
      "Occasionally the surprise is intentional (genuine dissociation or absent-mindedness). Rewriter should judge."],

    [2, "FILTER_WORD", "\\bcould\\s+smell\\b", "gi",
      "Remove 'could smell' — describe the scent directly.", false,
      "'She could smell smoke' → 'Smoke hung in the air' or 'The sharp tang of smoke reached her.' Direct sensory is stronger.",
      "In dialogue, skip."],

    [2, "FILTER_WORD", "\\bcould\\s+taste\\b", "gi",
      "Remove 'could taste' — describe the taste directly.", false,
      "'He could taste blood' → 'Blood coated his tongue' or 'Copper filled his mouth.' Direct sensory is stronger.",
      "In dialogue, skip."],
  ]

  for (const [tier, category, pattern, flags, fix_template, dialogue_ok, rationale, edge_cases] of patterns) {
    await db`
      INSERT INTO lint_patterns (tier, category, pattern, flags, fix_template, dialogue_ok, rationale, edge_cases)
      VALUES (${tier}, ${category}, ${pattern}, ${flags}, ${fix_template}, ${dialogue_ok}, ${rationale}, ${edge_cases})
    `
  }
}

async function seedTier3Patterns() {
  const [tier3Row] = await db`SELECT COUNT(*) as c FROM lint_patterns WHERE tier = 3`
  if ((tier3Row as any).c > 0) return

  const patterns: [number, string, string, string, string, boolean, string, string | null][] = [
    // ── Tier 3: Said bookisms (dialogue tag abuse) ──────────────
    [3, "SAID_BOOKISM", "\\b(exclaimed|proclaimed|declared|announced|stated|remarked|uttered|intoned|opined|asserted|murmured|breathed|hissed|growled|snarled|barked|snapped|chirped|quipped|mused|crooned)\\b(?=\\s|,|\\.|$)", "gi",
      "Replace with 'said' or an action beat.", false,
      "Fancy dialogue tags call attention to themselves and away from the dialogue. 'Said' is invisible to readers. Action beats ('She set down the cup.') do more work than any tag.",
      "Exception: 'whispered' and 'shouted' are fine when volume matters. 'Asked' for questions. In dialogue-heavy scenes, occasional variety is natural — flag only when the tag is doing the emotion's job."],

    [3, "SAID_BOOKISM", "\\bsaid\\s+(softly|loudly|quietly|angrily|sadly|happily|nervously|anxiously|cheerfully|sarcastically|bitterly|wearily|eagerly|reluctantly|firmly|gently|coldly|warmly)\\b", "gi",
      "Cut the adverb — let dialogue or action convey tone.", false,
      "'Said angrily' tells the reader how to hear the line instead of writing dialogue that sounds angry on its own. The adverb is a crutch for weak dialogue.",
      "Rare exception: when the adverb contradicts the words ('Fine,' she said coldly) and the contrast is the point."],

    // ── Tier 3: Declared emotions (telling feelings directly) ───
    [3, "DECLARED_EMOTION", "\\b(she|he|they|[A-Z][a-z]+)\\s+(was|were|felt)\\s+(angry|sad|happy|afraid|scared|nervous|anxious|excited|frustrated|annoyed|furious|terrified|heartbroken|devastated|elated|thrilled|relieved|embarrassed|ashamed|guilty|jealous|lonely|confused|shocked|stunned|disgusted|horrified|delighted|overjoyed|miserable|desperate|hopeful|grateful|proud|content)\\b", "g",
      "Show the emotion through body language, action, or dialogue instead.", false,
      "Naming the emotion short-circuits the reader's experience. 'She was afraid' gives information. 'Her hands shook; she couldn't get the key into the lock' creates the feeling.",
      "In rapid-fire action where pacing matters, a quick emotion label can work. In dialogue ('I'm angry'), the character is speaking — skip. Internal monologue may name emotions the character is processing."],

    [3, "DECLARED_EMOTION", "\\b(a\\s+)?(wave|surge|pang|jolt|rush|stab|flash|flicker|spark|burst)\\s+of\\s+(anger|sadness|happiness|fear|grief|joy|rage|terror|panic|dread|guilt|shame|relief|hope|love|hatred|jealousy|longing|anxiety|despair|excitement|frustration)\\b", "gi",
      "Replace the abstraction with a physical sensation or action.", false,
      "'A wave of grief' is a cliché that names the emotion wrapped in a dead metaphor. Show the grief through what the character does or feels physically: 'Her chest caved. She sat down on the curb because her legs wouldn't hold.'",
      "Occasionally the character is analytically noting their own emotion in internal monologue — the rewriter should judge."],
  ]

  for (const [tier, category, pattern, flags, fix_template, dialogue_ok, rationale, edge_cases] of patterns) {
    await db`
      INSERT INTO lint_patterns (tier, category, pattern, flags, fix_template, dialogue_ok, rationale, edge_cases)
      VALUES (${tier}, ${category}, ${pattern}, ${flags}, ${fix_template}, ${dialogue_ok}, ${rationale}, ${edge_cases})
    `
  }
}

async function seedAITellPatterns() {
  const [row] = await db`SELECT COUNT(*) as c FROM lint_patterns WHERE category = 'AI_CLICHE'`
  if ((row as any).c > 0) return

  const patterns: [number, string, string, string, string, boolean, string, string | null][] = [
    // ── AI Cliches (Tier 2) — sourced from docs/ai-tells-cliches-purple-prose.md ──

    // AC-1: The Weight of [Abstract Noun]
    [2, "AI_CLICHE", "\\bthe\\s+weight\\s+of\\s+(the\\s+)?(silence|guilt|grief|loss|responsibility|decision|moment|words|absence|truth|realization|unspoken|everything|it\\s+all|what|her|his|their)\\b", "gi",
      "Replace the abstraction with a physical sensation — pressure in the chest, heaviness in the limbs.", true,
      "Orwell: dead metaphors 'have lost all evocative power.' The construction adds a metaphorical frame that contributes nothing.",
      "'The weight of her words' could be legitimate if the character is literally measuring the impact of specific words."],

    // AC-2: The Silence Stretched / Hung / Settled
    [2, "AI_CLICHE", "\\b(the\\s+|a\\s+|an?\\s+\\w+\\s+)?silence\\s+(stretched|hung|settled|thickened|filled|descended|fell|pressed|grew|lingered|deepened|dragged|swallowed|enveloped|blanketed)\\b", "gi",
      "Cut the silence sentence, or show what the character hears in the silence: a clock, breathing, their own heartbeat.", true,
      "AI 'is not trained to generate silence' — instead it fills pauses with description of the pause itself.",
      "In horror or surrealist fiction, personified silence may be a deliberate genre convention."],

    // AC-3: Something Shifted (In/Between)
    [2, "AI_CLICHE", "\\bsomething\\s+(shifted|changed|passed|broke|snapped|clicked|loosened|tightened|cracked|stirred)\\s+(in|between|within|behind|across)\\b", "gi",
      "Name what shifted — the character's understanding? Their posture? The dynamic between them?", true,
      "The problem is not 'something' but the refusal to commit to specifics.",
      "In mystery/thriller POV where the character genuinely cannot identify what changed."],

    // AC-4: A Flicker of [Emotion]
    [2, "AI_CLICHE", "\\ba\\s+flicker\\s+of\\s+(something|recognition|doubt|surprise|emotion|fear|hope|anger|amusement|irritation|pain|hesitation|interest|warmth|concern|understanding|uncertainty|awareness|guilt|sadness|curiosity|defiance|vulnerability|unease|discomfort)\\b", "gi",
      "Replace with a concrete physical detail: a tightened jaw, a quick glance away, fingers curling.", true,
      "AI models use 'flicker' at vastly higher rates than human writers. King: show, don't tell.",
      null],

    // AC-5: The Air Between/Around Them
    [2, "AI_CLICHE", "\\bthe\\s+air\\s+(between|around|surrounding)\\s+(them|her|him|us)\\s+(felt\\s+)?(charged|shifted|thickened|crackled|hummed|grew|changed|turned|became|seemed|was)\\b", "gi",
      "Cut the sentence. Show tension through character behavior: averted eyes, a step backward, a voice that drops.", true,
      "Describing the air is a deflection from describing the characters.",
      "Literal temperature change (magic systems, environmental descriptions)."],

    // AC-6: Hung/Settled In the Air/Room
    [2, "AI_CLICHE", "\\b(words?|tension|question|threat|accusation|implication|promise|truth|lie|silence|grief|sadness|anger|fear|dread|unease)\\s+(hung|settled|lingered|hovered|floated)\\s+(in|over|between|across|throughout)\\s+(the\\s+)?(air|room|space|silence|gap|void|darkness)\\b", "gi",
      "Cut the sentence or replace with character reaction — what they do with their hands, whether they look away.", true,
      "Orwell: a dead metaphor has 'reverted to being an ordinary word.' The 'hung in the air' construction evokes nothing.",
      "'Smoke hung in the air' (literal) will not match because 'smoke' is not in the subject list."],

    // AC-7: The World Fell Away
    [2, "AI_CLICHE", "\\b(the\\s+world|everything(\\s+else)?|the\\s+rest\\s+of\\s+the\\s+world|reality|the\\s+room|the\\s+noise|the\\s+sounds?)\\s+(fell\\s+away|narrowed|shifted|faded|blurred|dissolved|disappeared|melted|receded|shrank|tilted|went\\s+quiet|went\\s+still|went\\s+silent|ceased\\s+to\\s+exist|ceased\\s+to\\s+matter)\\b", "gi",
      "Show focus through sensory narrowing: what the character stops hearing, what they see in sharp detail.", true,
      "King: show through concrete detail rather than announcing emotional states. 'The world fell away' is maximally abstract.",
      "In fantasy/sci-fi where reality literally shifts or dissolves."],

    // AC-8: Couldn't Quite Place
    [2, "AI_CLICHE", "\\bcouldn'?t\\s+(quite\\s+)?(place|name|identify|describe|put\\s+(her|his|their|a)\\s+(finger\\s+on|words?\\s+to)|explain|articulate|define|pin\\s*down)\\b", "gi",
      "Commit to the feeling. Show confusion through contradictory impulses or physical restlessness.", true,
      "This construction occupies space while delivering nothing. The writer's job is to find the right word, not announce it can't be found.",
      "Mystery/thriller where inability to identify is plot-relevant."],

    // AC-9: Something About Him/Her
    [2, "AI_CLICHE", "\\b(there\\s+was\\s+)?something\\s+about\\s+(him|her|them|his|her|their|the\\s+way)\\b", "gi",
      "Name the 'something' — the angle of their jaw? The way they hold their coffee cup? Eye contact a beat too long?", true,
      "Strunk & White: 'Prefer the specific to the general.' This is the general masquerading as the specific.",
      "First-person narration where the character is genuinely processing an unclear impression."],

    // AC-10: A Familiar Ache/Pang/Tug
    [2, "AI_CLICHE", "\\b(a|the|that)\\s+(familiar|unfamiliar|old|strange|sudden|sharp|dull|deep)\\s+(ache|pang|tug|pull|twist|knot|hollow|heaviness|tightness|prickle|sting)\\s+(of|in|behind|settled|formed|bloomed|spread|radiated)\\b", "gi",
      "Replace with the specific physical sensation and its location, grounded in this character's history.", true,
      "King: 'Description begins in the writer's imagination, but should finish in the reader's.' This starts and finishes in abstraction.",
      "Literary fiction with deliberate callback structure referencing a specific earlier scene."],

    // AC-11: Breath Didn't Know Holding
    [2, "AI_CLICHE", "\\b(let\\s+out|released|exhaled)\\s+(a\\s+|the\\s+)?breath\\s+(s?he|they|I|she|he)\\s+(didn'?t|hadn'?t|did\\s+not|had\\s+not)\\s+(know|realize|notice)", "gi",
      "Cut entirely. Show tension release through a different physical channel: shoulders dropping, fingers unclenching.", true,
      "The #1 recognized AI fiction cliche. Appears on virtually every 'fiction cliches to avoid' list.",
      null],

    // AC-12: Eyes Didn't Know Searching
    [2, "AI_CLICHE", "\\beyes\\s+(s?he|they|I)\\s+(didn'?t|hadn'?t|did\\s+not|had\\s+not)\\s+(know|realize)\\s+(s?he'?d|they'?d|I'?d)\\s+been\\b", "gi",
      "Cut and replace with a specific observation about the eyes or the moment of eye contact.", true,
      "A variant of the 'didn't know they were [verb]-ing' template that distances the reader.",
      null],

    // AC-13: Voice Barely Above a Whisper
    [2, "AI_CLICHE", "\\bvoice\\s+(was\\s+)?(barely|hardly|scarcely)\\s+(above|more\\s+than)\\s+(a\\s+)?whisper\\b", "gi",
      "Use 'whispered' or show the listener straining to hear, leaning closer.", false,
      "King: dialogue tags should be invisible. This construction does the work a simple 'whispered' could handle.",
      null],

    // AC-14: Tension Didn't Know Carrying
    [2, "AI_CLICHE", "\\b(tension|tightness|stiffness|knot)\\s+(s?he|they|I)\\s+(didn'?t|hadn'?t|did\\s+not|had\\s+not)\\s+(know|realize|notice)\\s+(s?he'?d|they'?d|I'?d)\\s+been\\s+(carrying|holding|clenching)\\b", "gi",
      "Show the release: rolling the neck, stretching fingers that had been balled, pressing palms into lower back.", true,
      "The 'didn't know [had been doing]' template is a three-pronged AI cliche family. Cut the frame, keep the action.",
      null],

    // AC-15: Shiver Down Spine
    [2, "AI_CLICHE", "\\b(sent|ran|crawled|crept|shot|traced)\\s+(a\\s+)?(shiver|chill|cold|tingle|thrill)\\s+(down|up|through|along)\\s+(his|her|their|my|the)\\s+(spine|back|body|arms?|neck)\\b", "gi",
      "Replace with specific physical reaction: goosebumps, hair lifting on the neck, a sudden need to look over the shoulder.", true,
      "Appears on virtually every 'fiction cliches to avoid' list. Too generic to create sensation.",
      "In horror/thriller, spine-related sensations are a genre convention but still a cliche."],

    // ── Hedging/Qualifying (Tier 2) — sourced from docs/ai-tells-hedging-qualifying.md ──

    // HQ-1: Perhaps/Maybe in Narration
    [2, "HEDGE_QUALIFIER", "\\b(perhaps|maybe)\\b", "gi",
      "Remove the hedge and commit. If the character is uncertain, rephrase as a direct question or action.", true,
      "Zinsser: 'perhaps' among qualifiers that 'whittle away the reader's trust.' AI RLHF training penalizes confident assertions, inflating hedge frequency.",
      "Deep POV close-third where narrator voice merges with character thoughts. Test: does removing 'perhaps' change the meaning?"],

    // HQ-2: It Was As Though/If
    [2, "HEDGE_QUALIFIER", "\\bit\\s+was\\s+as\\s+(though|if)\\b", "gi",
      "Replace with a direct simile on a concrete subject. 'It was as though the room had shrunk' → 'The walls pressed closer.'", false,
      "Browne & King R.U.E. principle: the narrator is explaining what something resembles instead of rendering it directly.",
      "Kafkaesque or absurdist register where the impersonal 'it' is thematic. Extremely rare."],

    // HQ-3: In a Way That
    [2, "HEDGE_QUALIFIER", "\\bin\\s+a\\s+way\\s+that\\b", "gi",
      "Replace with a specific description. 'She spoke in a way that made him uncomfortable' → describe the specific manner.", false,
      "Zinsser: 'in a sense' and similar constructions are clutter that 'don't mean anything.' Fiction equivalent of gesturing at meaning.",
      "Philosophical or essayistic narration where abstraction is intentional."],

    // HQ-4: Something Like/Akin To
    [2, "HEDGE_QUALIFIER", "\\bsomething\\s+(like|akin\\s+to)\\b", "gi",
      "Commit to the comparison or replace with concrete sensation. 'Something like grief' → 'Grief' or describe the physical sensation.", true,
      "Stein: triage would strip 'something like' as a failed qualifier. The construction signals the writer could not find the word.",
      "A character who genuinely cannot name what they feel — render through physical confusion instead."],

    // HQ-5: Almost As If
    [2, "HEDGE_QUALIFIER", "\\balmost\\s+as\\s+if\\b", "gi",
      "Remove the double hedge. Choose either a direct simile or commit to the image. One comparison layer maximum.", true,
      "Clark: stacked qualifiers compound trust erosion. The double hedge is a diagnostic marker for AI prose.",
      null],

    // HQ-6: Sort Of/Kind Of
    [2, "HEDGE_QUALIFIER", "\\b(sort|kind)\\s+of\\b", "gi",
      "Remove the hedge and commit. 'She kind of smiled' → 'She smiled' or find a precise verb.", true,
      "Zinsser lists 'sort of' and 'kind of' explicitly as qualifiers to prune.",
      "First-person narrators with a casual, conversational voice (YA, humorous fiction)."],

    // HQ-7: A Certain/Some Kind Of
    [2, "HEDGE_QUALIFIER", "\\b(a\\s+certain|some\\s+kind\\s+of)\\b", "gi",
      "Replace with a specific description. 'A certain sadness in her eyes' → 'Her eyes were red-rimmed.'", true,
      "'A certain' promises specificity and fails to deliver. Lukeman flags vague description as a rejection signal.",
      "'A certain' for deliberate withholding in mystery. 'Some kind of' when POV character genuinely cannot identify the thing."],

    // HQ-8: Somehow/Somewhat
    [2, "HEDGE_QUALIFIER", "\\b(somehow|somewhat)\\b", "gi",
      "'Somehow': show the mechanism or remove. 'Somewhat': commit to the degree or cut.", true,
      "'Somehow' is specifically flagged as a logic gap the writer hasn't resolved. 'Somewhat' has essentially no legitimate narration use.",
      "'Somehow' in genuine mystery narration where the mechanism is deliberately withheld as plot tension."],

    // HQ-9: It/There Seemed
    [2, "HEDGE_QUALIFIER", "\\b(it|there)\\s+seemed\\b", "gi",
      "Remove the hedge and commit. 'It seemed darker' → 'The hallway was darker.' Show uncertainty through sensory confusion.", false,
      "Browne & King R.U.E. principle: 'it seemed' is a filter word wearing an existential disguise.",
      "Deliberately unreliable narration where hedging is thematic."],

    // HQ-10: Couldn't Help But
    [2, "HEDGE_QUALIFIER", "\\bcouldn't\\s+help\\s+but\\b", "gi",
      "Remove the involuntary frame — let the character act. 'She couldn't help but smile' → 'She smiled.'", true,
      "Tells the reader the character couldn't resist instead of showing the resistance or lack thereof.",
      "When involuntary nature is genuinely load-bearing. Even then, 'the laugh came anyway' is stronger."],

    // HQ-11: Electricity/Magnetism Between Characters
    [2, "HEDGE_QUALIFIER", "\\b(electricity|electric\\s+current|magnetism|magnetic\\s+pull)\\b.*?\\b(between|through|crackled|coursed|flowed|passed|sparked|surged|pulsed|hummed)\\b", "gi",
      "Replace with specific physical sensation: 'Her skin prickled where his arm brushed hers' or 'She forgot what she was saying.'", false,
      "A recognized dead metaphor in fiction editing. Ellen Brock identifies overused similes as a signal of unrevised prose.",
      "Literal electricity in sci-fi/fantasy settings."],

    // HQ-12: Air/Atmosphere Charged/Thickened
    [2, "HEDGE_QUALIFIER", "\\b(the\\s+)?(air|atmosphere)\\s+(between\\s+(them|her|him|us))?\\s*(thickened|shifted|changed|charged|crackled|hummed|grew\\s+(heavy|thick|tense|still))\\b", "gi",
      "Replace with a physical sensation or behavioral change. 'The air thickened' → 'She became aware of how close he was standing.'", false,
      "Instead of naming emotion in a character, the narrator projects it onto the environment. Characters feel things, not atmospheres.",
      "Fantasy where atmosphere literally changes (magic). Actual weather descriptions."],
  ]

  for (const [tier, category, pattern, flags, fix_template, dialogue_ok, rationale, edge_cases] of patterns) {
    await db`
      INSERT INTO lint_patterns (tier, category, pattern, flags, fix_template, dialogue_ok, rationale, edge_cases)
      VALUES (${tier}, ${category}, ${pattern}, ${flags}, ${fix_template}, ${dialogue_ok}, ${rationale}, ${edge_cases})
    `
  }
}

// ── Run management ───────────────────────────────────────────────────────

export function snapshotModelConfig(): string {
  return JSON.stringify(AGENT_MODELS)
}

export async function createRun(runType: string, runRef?: string, label?: string, experimentId?: number): Promise<number> {
  const config = snapshotModelConfig()
  const [result] = await db`
    INSERT INTO runs (run_type, run_ref, model_config, label, experiment_id)
    VALUES (${runType}, ${runRef ?? null}, ${config}, ${label ?? null}, ${experimentId ?? null})
    RETURNING id
  `
  const runId = (result as any).id as number

  for (const [agent, assignment] of Object.entries(AGENT_MODELS)) {
    await db`
      INSERT INTO run_agents (run_id, agent, provider, model)
      VALUES (${runId}, ${agent}, ${(assignment as ModelAssignment).provider}, ${(assignment as ModelAssignment).model})
    `
  }

  return runId
}

// ── LLM call logging ─────────────────────────────────────────────────────

export interface LLMCallData {
  agent: string
  phase?: string
  model: string
  provider: string
  temperature?: number
  maxTokens?: number
  promptTokens: number
  completionTokens: number
  latencyMs: number
  cost: number
  chapter?: number
  seed?: string
  dimension?: string
  jsonExtractionSuccess?: boolean
  jsonExtractionRetried?: boolean
  zodValidationSuccess?: boolean
  zodErrors?: string[]
  httpAttempts?: number
  retryErrors?: Array<{ status: number; delay: number }>
  // Inspection columns (sql/017_llm_call_inspection.sql) — full text + tags
  systemPrompt?: string
  userPrompt?: string
  responseContent?: string
  novelId?: string
  beatIndex?: number
  attempt?: number
  // Failure capture (sql/018_llm_call_errors.sql) — guarantee one row per attempt
  requestJson?: Record<string, any>
  failed?: boolean
  errorText?: string
}

export async function logLLMCall(runId: number, data: LLMCallData): Promise<void> {
  const tps = data.latencyMs > 0 && data.completionTokens > 0
    ? Math.round(data.completionTokens / (data.latencyMs / 1000))
    : 0

  await db`
    INSERT INTO llm_calls (
      run_id, agent, phase, model, provider, temperature, max_tokens,
      prompt_tokens, completion_tokens, latency_ms, tokens_per_sec, cost,
      chapter, seed, dimension,
      json_extraction_success, json_extraction_retried,
      zod_validation_success, zod_errors, http_attempts, retry_errors,
      system_prompt, user_prompt, response_content,
      novel_id, beat_index, attempt,
      request_json, failed, error_text
    ) VALUES (
      ${runId}, ${data.agent}, ${data.phase ?? null}, ${data.model}, ${data.provider},
      ${data.temperature ?? null}, ${data.maxTokens ?? null},
      ${data.promptTokens}, ${data.completionTokens},
      ${Math.round(data.latencyMs)}, ${tps}, ${data.cost},
      ${data.chapter ?? null}, ${data.seed ?? null}, ${data.dimension ?? null},
      ${data.jsonExtractionSuccess ?? true},
      ${data.jsonExtractionRetried ?? false},
      ${data.zodValidationSuccess ?? true},
      ${data.zodErrors?.length ? JSON.stringify(data.zodErrors) : null},
      ${data.httpAttempts ?? 1},
      ${data.retryErrors?.length ? JSON.stringify(data.retryErrors) : null},
      ${data.systemPrompt ?? null},
      ${data.userPrompt ?? null},
      ${data.responseContent ?? null},
      ${data.novelId ?? null},
      ${data.beatIndex ?? null},
      ${data.attempt ?? null},
      ${data.requestJson ? JSON.stringify(data.requestJson) : null},
      ${data.failed ?? false},
      ${data.errorText ?? null}
    )
  `
}

// ── Benchmark generations & scores ───────────────────────────────────────

export async function saveGeneration(
  runId: number, seed: string, attempt: number,
  data: { prose?: string; wordCount?: number; latencyMs?: number; tokensPerSec?: number; completionTokens?: number; passed: boolean; variantLabel?: string },
): Promise<number> {
  const [result] = await db`
    INSERT INTO generations (run_id, seed, attempt, prose, word_count, latency_ms, tokens_per_sec, completion_tokens, passed, variant_label)
    VALUES (
      ${runId}, ${seed}, ${attempt}, ${data.prose ?? null}, ${data.wordCount ?? null},
      ${data.latencyMs ?? null}, ${data.tokensPerSec ?? null}, ${data.completionTokens ?? null},
      ${data.passed}, ${data.variantLabel ?? null}
    )
    RETURNING id
  `
  return (result as any).id as number
}

export async function saveScore(generationId: number, judge: string, dimension: string, score: number, reasoning: string): Promise<void> {
  await db`
    INSERT INTO scores (generation_id, judge, dimension, score, reasoning)
    VALUES (${generationId}, ${judge}, ${dimension}, ${score}, ${reasoning})
  `
}

export async function markBaseline(runId: number, benchmarkType: string): Promise<void> {
  await db`
    INSERT INTO baselines (benchmark_type, run_id)
    VALUES (${benchmarkType}, ${runId})
    ON CONFLICT (benchmark_type) DO UPDATE SET run_id = EXCLUDED.run_id, set_at = now()
  `
}

// ── Query: per-run ───────────────────────────────────────────────────────

export interface DimensionAvg { dimension: string; avg: number; stddev: number }

export async function getRunAverages(runId: number): Promise<DimensionAvg[]> {
  return await db`
    SELECT s.dimension,
           ROUND(AVG(s.score)::numeric, 1)::float as avg,
           ROUND(SQRT(AVG(s.score * s.score) - AVG(s.score) * AVG(s.score))::numeric, 1)::float as stddev
    FROM scores s
    JOIN generations g ON s.generation_id = g.id
    WHERE g.run_id = ${runId} AND g.passed = true
    GROUP BY s.dimension
  ` as DimensionAvg[]
}

export async function getOverallAvg(runId: number): Promise<{ mean: number; stddev: number }> {
  const [result] = await db`
    SELECT ROUND(AVG(s.score)::numeric, 1)::float as mean,
           ROUND(SQRT(AVG(s.score * s.score) - AVG(s.score) * AVG(s.score))::numeric, 1)::float as stddev
    FROM scores s
    JOIN generations g ON s.generation_id = g.id
    WHERE g.run_id = ${runId} AND g.passed = true
  `
  return (result as any) ?? { mean: 0, stddev: 0 }
}

export async function getBaselineAverages(benchmarkType: string): Promise<DimensionAvg[] | null> {
  const [baseline] = await db`SELECT run_id FROM baselines WHERE benchmark_type = ${benchmarkType}`
  if (!baseline) return null
  return getRunAverages((baseline as any).run_id)
}

export async function getPerSeedAverages(runId: number): Promise<Array<{ seed: string; dimension: string; avg: number }>> {
  return await db`
    SELECT g.seed, s.dimension, ROUND(AVG(s.score)::numeric, 1)::float as avg
    FROM scores s
    JOIN generations g ON s.generation_id = g.id
    WHERE g.run_id = ${runId} AND g.passed = true
    GROUP BY g.seed, s.dimension
    ORDER BY g.seed, s.dimension
  ` as any[]
}

export async function getWeakestGenerations(runId: number, limit: number = 3): Promise<Array<{
  generationId: number; seed: string; attempt: number; avgScore: number; prose: string
}>> {
  return await db`
    SELECT g.id as "generationId", g.seed, g.attempt,
           ROUND(AVG(s.score)::numeric, 1)::float as "avgScore", g.prose
    FROM generations g
    JOIN scores s ON s.generation_id = g.id
    WHERE g.run_id = ${runId} AND g.passed = true
    GROUP BY g.id
    ORDER BY "avgScore" ASC
    LIMIT ${limit}
  ` as any[]
}

export async function getScoresForGeneration(generationId: number): Promise<Array<{ judge: string; dimension: string; score: number; reasoning: string }>> {
  return await db`
    SELECT judge, dimension, score, reasoning FROM scores WHERE generation_id = ${generationId}
  ` as any[]
}

// ── Query: cost & TPS ────────────────────────────────────────────────────

export async function getCallSummary(runId: number): Promise<Array<{
  agent: string; model: string; calls: number; totalCost: number; avgTps: number; totalPrompt: number; totalCompletion: number
}>> {
  return await db`
    SELECT agent, model, COUNT(*) as calls,
           ROUND(SUM(cost)::numeric, 6)::float as "totalCost",
           ROUND(AVG(CASE WHEN tokens_per_sec > 0 THEN tokens_per_sec END))::int as "avgTps",
           SUM(prompt_tokens) as "totalPrompt",
           SUM(completion_tokens) as "totalCompletion"
    FROM llm_calls WHERE run_id = ${runId}
    GROUP BY agent, model
    ORDER BY agent, "totalCost" DESC
  ` as any[]
}

// ── Query: cross-run model comparison ────────────────────────────────────

export async function getRecentRuns(runType: string, limit: number = 10): Promise<Array<{
  id: number; label: string | null; runRef: string | null; timestamp: string; mean: number
}>> {
  return await db`
    SELECT r.id, r.label, r.run_ref as "runRef", r.timestamp,
           ROUND(AVG(s.score)::numeric, 1)::float as mean
    FROM runs r
    JOIN generations g ON g.run_id = r.id
    JOIN scores s ON s.generation_id = g.id
    WHERE r.run_type = ${runType} AND g.passed = true
    GROUP BY r.id
    ORDER BY r.timestamp DESC
    LIMIT ${limit}
  ` as any[]
}

export async function getAgentModelScores(runType: string): Promise<Array<{
  agent: string; provider: string; model: string; runs: number; avgScore: number; avgTps: number; avgCostPerCall: number
}>> {
  return await db`
    SELECT ra.agent, ra.provider, ra.model,
           COUNT(DISTINCT r.id) as runs,
           ROUND(AVG(s.score)::numeric, 1)::float as "avgScore",
           ROUND(AVG(CASE WHEN lc.tokens_per_sec > 0 THEN lc.tokens_per_sec END))::int as "avgTps",
           ROUND(AVG(lc.cost)::numeric, 6)::float as "avgCostPerCall"
    FROM run_agents ra
    JOIN runs r ON r.id = ra.run_id
    JOIN generations g ON g.run_id = r.id
    JOIN scores s ON s.generation_id = g.id
    LEFT JOIN llm_calls lc ON lc.run_id = r.id AND lc.agent = ra.agent
    WHERE r.run_type = ${runType} AND g.passed = true
    GROUP BY ra.agent, ra.provider, ra.model
    ORDER BY ra.agent, "avgScore" DESC
  ` as any[]
}

export async function compareRuns(runIdA: number, runIdB: number): Promise<{
  configDiff: Array<{ agent: string; from: string; to: string }>;
  scoreDiff: Array<{ dimension: string; scoreA: number; scoreB: number; delta: number }>;
  costDiff: { costA: number; costB: number; delta: number };
}> {
  const [runA] = await db`SELECT model_config FROM runs WHERE id = ${runIdA}`
  const [runB] = await db`SELECT model_config FROM runs WHERE id = ${runIdB}`

  const configDiff: Array<{ agent: string; from: string; to: string }> = []
  if (runA && runB) {
    const a = JSON.parse((runA as any).model_config) as Record<string, ModelAssignment>
    const b = JSON.parse((runB as any).model_config) as Record<string, ModelAssignment>
    for (const agent of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const ma = a[agent] ? `${a[agent].provider}/${a[agent].model}` : "—"
      const mb = b[agent] ? `${b[agent].provider}/${b[agent].model}` : "—"
      if (ma !== mb) configDiff.push({ agent, from: ma, to: mb })
    }
  }

  const avgsA = await getRunAverages(runIdA)
  const avgsB = await getRunAverages(runIdB)
  const allDims = new Set([...avgsA.map(a => a.dimension), ...avgsB.map(b => b.dimension)])
  const scoreDiff = [...allDims].map(dim => {
    const a = avgsA.find(x => x.dimension === dim)?.avg ?? 0
    const b = avgsB.find(x => x.dimension === dim)?.avg ?? 0
    return { dimension: dim, scoreA: a, scoreB: b, delta: Math.round((b - a) * 10) / 10 }
  })

  const [costRowA] = await db`SELECT COALESCE(SUM(cost), 0) as total FROM llm_calls WHERE run_id = ${runIdA}`
  const [costRowB] = await db`SELECT COALESCE(SUM(cost), 0) as total FROM llm_calls WHERE run_id = ${runIdB}`
  const costA = Number((costRowA as any)?.total ?? 0)
  const costB = Number((costRowB as any)?.total ?? 0)

  return { configDiff, scoreDiff, costDiff: { costA, costB, delta: Math.round((costB - costA) * 1e4) / 1e4 } }
}

// ── Query: global aggregates ─────────────────────────────────────────────

export async function getModelStats(): Promise<Array<{
  provider: string; model: string; totalCalls: number; totalCost: number; avgTps: number; avgLatencyMs: number
}>> {
  return await db`
    SELECT provider, model,
           COUNT(*) as "totalCalls",
           ROUND(SUM(cost)::numeric, 4)::float as "totalCost",
           ROUND(AVG(CASE WHEN tokens_per_sec > 0 THEN tokens_per_sec END))::int as "avgTps",
           ROUND(AVG(latency_ms))::int as "avgLatencyMs"
    FROM llm_calls
    GROUP BY provider, model
    ORDER BY "totalCalls" DESC
  ` as any[]
}

export async function getAgentStats(): Promise<Array<{
  agent: string; totalCalls: number; totalCost: number; avgTps: number; avgLatencyMs: number
}>> {
  return await db`
    SELECT agent,
           COUNT(*) as "totalCalls",
           ROUND(SUM(cost)::numeric, 4)::float as "totalCost",
           ROUND(AVG(CASE WHEN tokens_per_sec > 0 THEN tokens_per_sec END))::int as "avgTps",
           ROUND(AVG(latency_ms))::int as "avgLatencyMs"
    FROM llm_calls
    GROUP BY agent
    ORDER BY "totalCost" DESC
  ` as any[]
}

// ── Tuning experiments ──────────────────────────────────────────────────

async function getGitCommitHash(): Promise<string | null> {
  try {
    const proc = Bun.spawn(["git", "rev-parse", "HEAD"], { stdout: "pipe", stderr: "ignore" })
    const text = await new Response(proc.stdout).text()
    return text.trim().slice(0, 12) || null
  } catch { return null }
}

export async function createTuningExperiment(
  type: string, description: string, config: Record<string, any>,
  opts?: { target?: string; dimension?: string },
): Promise<number> {
  const commitHash = await getGitCommitHash()
  const [result] = await db`
    INSERT INTO tuning_experiments (experiment_type, description, config, target, dimension, commit_hash)
    VALUES (${type}, ${description}, ${config}, ${opts?.target ?? null}, ${opts?.dimension ?? null}, ${commitHash})
    RETURNING id
  `
  return (result as any).id as number
}

export async function concludeExperiment(experimentId: number, conclusion: string): Promise<void> {
  await db`UPDATE tuning_experiments SET conclusion = ${conclusion} WHERE id = ${experimentId}`
}

export async function linkExperiment(experimentId: number, parentExperimentId: number, relationship: string = "continuation"): Promise<void> {
  await db`
    INSERT INTO experiment_lineage (experiment_id, parent_experiment_id, relationship)
    VALUES (${experimentId}, ${parentExperimentId}, ${relationship})
  `
}

export async function getRelatedExperiments(target: string, dimension: string, limit: number = 10): Promise<any[]> {
  return db`
    SELECT id, description, conclusion, config, timestamp
    FROM tuning_experiments
    WHERE target = ${target} AND dimension = ${dimension} AND conclusion IS NOT NULL
    ORDER BY id DESC LIMIT ${limit}
  `
}

export async function saveTuningResult(
  experimentId: number,
  data: {
    model: string; rubric: string; sample: string; run: number;
    score?: number; issues?: Array<{ quote: string; problem: string }>;
    reasoning?: string; latencyMs?: number; failed?: boolean;
  },
): Promise<void> {
  await db`
    INSERT INTO tuning_results (experiment_id, model, rubric, sample, run, score, issues, reasoning, latency_ms, failed)
    VALUES (
      ${experimentId}, ${data.model}, ${data.rubric}, ${data.sample}, ${data.run},
      ${data.score ?? null}, ${data.issues ? JSON.stringify(data.issues) : null},
      ${data.reasoning ?? null}, ${data.latencyMs ?? null}, ${data.failed ?? false}
    )
  `
}

export async function getTuningExperiments(type?: string): Promise<Array<{
  id: number; timestamp: string; experimentType: string; description: string; config: string
}>> {
  if (type) {
    return await db`
      SELECT id, timestamp, experiment_type as "experimentType", description, config
      FROM tuning_experiments WHERE experiment_type = ${type} ORDER BY id DESC
    ` as any[]
  }
  return await db`
    SELECT id, timestamp, experiment_type as "experimentType", description, config
    FROM tuning_experiments ORDER BY id DESC
  ` as any[]
}

export async function getTuningResults(experimentId: number): Promise<Array<{
  model: string; rubric: string; sample: string; run: number;
  score: number | null; issues: string | null; reasoning: string | null;
  latencyMs: number | null; failed: boolean
}>> {
  return await db`
    SELECT model, rubric, sample, run, score, issues, reasoning, latency_ms as "latencyMs", failed
    FROM tuning_results WHERE experiment_id = ${experimentId} ORDER BY rubric, sample, run
  ` as any[]
}

// ── Experiment queries (unified) ────────────────────────────────────────

export async function getExperimentRuns(experimentId: number): Promise<Array<{
  runId: number; label: string | null; variantLabel: string | null; timestamp: string
}>> {
  return await db`
    SELECT r.id as "runId", r.label, g.variant_label as "variantLabel", r.timestamp
    FROM runs r
    LEFT JOIN generations g ON g.run_id = r.id AND g.variant_label IS NOT NULL
    WHERE r.experiment_id = ${experimentId}
    GROUP BY r.id
    ORDER BY r.id
  ` as any[]
}

export async function getExperimentScores(experimentId: number): Promise<Array<{
  variantLabel: string; dimension: string; avg: number; stddev: number; count: number
}>> {
  return await db`
    SELECT COALESCE(g.variant_label, r.label) as "variantLabel",
           s.dimension,
           ROUND(AVG(s.score)::numeric, 2)::float as avg,
           ROUND(SQRT(AVG(s.score * s.score) - AVG(s.score) * AVG(s.score))::numeric, 2)::float as stddev,
           COUNT(*) as count
    FROM scores s
    JOIN generations g ON g.id = s.generation_id
    JOIN runs r ON r.id = g.run_id
    WHERE r.experiment_id = ${experimentId} AND g.passed = true
    GROUP BY "variantLabel", s.dimension
    ORDER BY "variantLabel", s.dimension
  ` as any[]
}

export async function getExperimentLintSummary(experimentId: number): Promise<Array<{
  variantLabel: string; category: string; count: number
}>> {
  return await db`
    SELECT COALESCE(g.variant_label, r.label) as "variantLabel",
           lp.category,
           COUNT(*) as count
    FROM lint_issues li
    JOIN lint_patterns lp ON lp.id = li.pattern_id
    JOIN generations g ON g.id = li.generation_id
    JOIN runs r ON r.id = g.run_id
    WHERE r.experiment_id = ${experimentId}
    GROUP BY "variantLabel", lp.category
    ORDER BY "variantLabel", count DESC
  ` as any[]
}

/** Unified experiment list — merges benchmark + improvement experiments */
export async function getAllExperiments(limit: number = 50): Promise<any[]> {
  return await db`
    SELECT
      te.id,
      te.experiment_type as type,
      te.description,
      te.target,
      te.dimension,
      te.conclusion,
      te.timestamp,
      ic.id as cycle_id,
      ic.status as cycle_status,
      ic.total_iterations,
      ic.kept_count,
      ic.total_cost_usd as cycle_cost,
      ic.dimension_locked,
      (SELECT COUNT(*) FROM runs r WHERE r.experiment_id = te.id) as run_count,
      (SELECT ROUND(SUM(lc.cost)::numeric, 6)::float FROM llm_calls lc JOIN runs r ON r.id = lc.run_id WHERE r.experiment_id = te.id) as total_cost,
      (SELECT json_agg(json_build_object('dimension', sub.dimension, 'avg_score', sub.avg_score))
       FROM (
         SELECT s.dimension, ROUND(AVG(s.score)::numeric, 2)::float as avg_score
         FROM scores s
         JOIN generations g ON g.id = s.generation_id
         JOIN runs r ON r.id = g.run_id
         WHERE r.experiment_id = te.id AND g.passed = true
         GROUP BY s.dimension
       ) sub
      ) as scores
    FROM tuning_experiments te
    LEFT JOIN improvement_cycles ic ON ic.experiment_id = te.id
    ORDER BY te.id DESC
    LIMIT ${limit}
  `
}

/** Fetch all generations for an experiment with prose, scores, and lint issues. */
export async function getExperimentGenerations(
  experimentId: number, limit: number = 20, offset: number = 0,
): Promise<Array<{
  id: number; seed: string; attempt: number; prose: string; wordCount: number
  variantLabel: string | null; runLabel: string | null; latencyMs: number | null
  scores: Array<{ dimension: string; score: number; reasoning: string | null; judge: string }>
  lintIssues: Array<{ category: string; match: string; sentence: string; charOffset: number }>
}>> {
  const gens = await db`
    SELECT g.id, g.seed, g.attempt, g.prose, g.word_count as "wordCount",
           g.variant_label as "variantLabel", r.label as "runLabel",
           g.latency_ms as "latencyMs"
    FROM generations g
    JOIN runs r ON r.id = g.run_id
    WHERE r.experiment_id = ${experimentId} AND g.passed = true AND g.prose IS NOT NULL
    ORDER BY g.variant_label, g.seed, g.attempt
    LIMIT ${limit} OFFSET ${offset}
  ` as any[]

  // Batch-fetch scores and lint for all generation IDs
  const genIds = gens.map((g: any) => g.id)
  if (genIds.length === 0) return []

  const [scores, lintIssues] = await Promise.all([
    db`SELECT s.generation_id, s.dimension, s.score, s.reasoning, s.judge
       FROM scores s
       WHERE s.generation_id IN (SELECT g.id FROM generations g JOIN runs r ON r.id = g.run_id WHERE r.experiment_id = ${experimentId} AND g.passed = true AND g.prose IS NOT NULL)
       ORDER BY s.dimension`,
    db`SELECT li.generation_id, lp.category, li.match, li.sentence, li.char_offset as "charOffset"
       FROM lint_issues li JOIN lint_patterns lp ON lp.id = li.pattern_id
       WHERE li.generation_id IN (SELECT g.id FROM generations g JOIN runs r ON r.id = g.run_id WHERE r.experiment_id = ${experimentId} AND g.passed = true AND g.prose IS NOT NULL)
       ORDER BY li.char_offset`,
  ])

  const scoresByGen = new Map<number, typeof scores>()
  for (const s of scores as any[]) {
    if (!scoresByGen.has(s.generation_id)) scoresByGen.set(s.generation_id, [])
    scoresByGen.get(s.generation_id)!.push(s)
  }

  const lintByGen = new Map<number, typeof lintIssues>()
  for (const l of lintIssues as any[]) {
    if (!lintByGen.has(l.generation_id)) lintByGen.set(l.generation_id, [])
    lintByGen.get(l.generation_id)!.push(l)
  }

  return gens.map((g: any) => ({
    ...g,
    scores: (scoresByGen.get(g.id) ?? []).map((s: any) => ({
      dimension: s.dimension, score: s.score, reasoning: s.reasoning, judge: s.judge,
    })),
    lintIssues: (lintByGen.get(g.id) ?? []).map((l: any) => ({
      category: l.category, match: l.match, sentence: l.sentence, charOffset: l.charOffset,
    })),
  }))
}

export async function getExperimentCost(experimentId: number): Promise<Array<{
  variantLabel: string; totalCost: number; totalCalls: number
}>> {
  return await db`
    SELECT r.label as "variantLabel",
           ROUND(SUM(lc.cost)::numeric, 6)::float as "totalCost",
           COUNT(*) as "totalCalls"
    FROM llm_calls lc
    JOIN runs r ON r.id = lc.run_id
    WHERE r.experiment_id = ${experimentId}
    GROUP BY r.label
    ORDER BY r.label
  ` as any[]
}

export async function saveExperimentSummary(experimentId: number, summary: string): Promise<void> {
  await db`UPDATE tuning_experiments SET summary = ${summary} WHERE id = ${experimentId}`
}

/**
 * Delete an experiment and all its cascading data.
 * Handles FK order: scores/lint_issues → generations → run_agents/llm_calls → runs → experiment.
 */
export async function deleteExperiment(experimentId: number): Promise<void> {
  const runRows = await db`SELECT id FROM runs WHERE experiment_id = ${experimentId}`
  const runIds = runRows.map((r: any) => r.id as number)

  if (runIds.length > 0) {
    const genRows = await db`SELECT id FROM generations WHERE run_id = ANY(${runIds})`
    const genIds = genRows.map((g: any) => g.id as number)

    if (genIds.length > 0) {
      await db`DELETE FROM scores WHERE generation_id = ANY(${genIds})`
      await db`DELETE FROM lint_issues WHERE generation_id = ANY(${genIds})`
      await db`DELETE FROM generations WHERE id = ANY(${genIds})`
    }
    await db`DELETE FROM llm_calls WHERE run_id = ANY(${runIds})`
    await db`DELETE FROM run_agents WHERE run_id = ANY(${runIds})`
    await db`DELETE FROM runs WHERE id = ANY(${runIds})`
  }
  await db`DELETE FROM tuning_experiments WHERE id = ${experimentId}`
}

// ── Pairwise comparison ────────────────────────────────────────────────

export async function savePairwiseMatchup(data: {
  experimentId?: number; generationA: number; generationB: number;
  labelA: string; labelB: string; seed: string; judgeModel: string;
  winner: "A" | "B" | "tie"; confidence: "strong" | "slight" | "tie";
  reasoning: string; position: "ab" | "ba"; latencyMs: number;
}): Promise<number> {
  const [result] = await db`
    INSERT INTO pairwise_matchups (experiment_id, generation_a, generation_b, label_a, label_b, seed, judge_model, winner, confidence, reasoning, position, latency_ms)
    VALUES (
      ${data.experimentId ?? null}, ${data.generationA}, ${data.generationB},
      ${data.labelA}, ${data.labelB}, ${data.seed}, ${data.judgeModel},
      ${data.winner}, ${data.confidence}, ${data.reasoning}, ${data.position}, ${data.latencyMs}
    )
    RETURNING id
  `
  return (result as any).id as number
}

export async function getPairwiseResults(experimentId: number): Promise<Array<{
  id: number; labelA: string; labelB: string; seed: string; winner: string;
  confidence: string; reasoning: string; position: string
}>> {
  return await db`
    SELECT id, label_a as "labelA", label_b as "labelB", seed, winner, confidence, reasoning, position
    FROM pairwise_matchups WHERE experiment_id = ${experimentId} ORDER BY id
  ` as any[]
}

// ── Batch processing ───────────────────────────────────────────────────

export async function createBatch(runId: number, provider: string, judgeModel: string): Promise<number> {
  const [result] = await db`
    INSERT INTO batches (run_id, provider, judge_model)
    VALUES (${runId}, ${provider}, ${judgeModel})
    RETURNING id
  `
  return (result as any).id as number
}

export async function addBatchRequest(batchId: number, customId: string, generationId: number, dimension: string): Promise<void> {
  await db`
    INSERT INTO batch_requests (batch_id, custom_id, generation_id, dimension)
    VALUES (${batchId}, ${customId}, ${generationId}, ${dimension})
  `
}

export async function updateBatchSubmitted(batchId: number, providerBatchId: string, inputFile: string, requestCount: number): Promise<void> {
  await db`
    UPDATE batches
    SET provider_batch_id = ${providerBatchId},
        input_file = ${inputFile},
        request_count = ${requestCount},
        status = 'submitted',
        submitted_at = now()
    WHERE id = ${batchId}
  `
}

export async function updateBatchStatus(batchId: number, status: string, error?: string): Promise<void> {
  const isTerminal = status === "completed" || status === "failed"
  if (isTerminal && error != null) {
    await db`
      UPDATE batches
      SET status = ${status}, completed_at = now(), error = ${error}
      WHERE id = ${batchId}
    `
  } else if (isTerminal) {
    await db`
      UPDATE batches
      SET status = ${status}, completed_at = now()
      WHERE id = ${batchId}
    `
  } else if (error != null) {
    await db`
      UPDATE batches
      SET status = ${status}, error = ${error}
      WHERE id = ${batchId}
    `
  } else {
    await db`
      UPDATE batches
      SET status = ${status}
      WHERE id = ${batchId}
    `
  }
}

export async function updateBatchOutput(batchId: number, outputFile: string): Promise<void> {
  await db`UPDATE batches SET output_file = ${outputFile} WHERE id = ${batchId}`
}

export async function completeBatchRequest(customId: string, score: number, issuesJson: string): Promise<void> {
  await db`
    UPDATE batch_requests
    SET status = 'completed', score = ${score}, issues_json = ${issuesJson}
    WHERE custom_id = ${customId}
  `
}

export async function failBatchRequest(customId: string): Promise<void> {
  await db`UPDATE batch_requests SET status = 'failed' WHERE custom_id = ${customId}`
}

export async function getPendingBatches(): Promise<Array<{
  id: number; runId: number; provider: string; providerBatchId: string; judgeModel: string; requestCount: number; status: string
}>> {
  return await db`
    SELECT id, run_id as "runId", provider, provider_batch_id as "providerBatchId",
           judge_model as "judgeModel", request_count as "requestCount", status
    FROM batches
    WHERE status IN ('pending', 'submitted', 'validating', 'processing')
    ORDER BY id
  ` as any[]
}

export async function getBatchRequests(batchId: number): Promise<Array<{
  id: number; customId: string; generationId: number; dimension: string; status: string; score: number | null; issuesJson: string | null
}>> {
  return await db`
    SELECT id, custom_id as "customId", generation_id as "generationId",
           dimension, status, score, issues_json as "issuesJson"
    FROM batch_requests WHERE batch_id = ${batchId} ORDER BY id
  ` as any[]
}

export async function getBatchForRun(runId: number): Promise<Array<{
  id: number; provider: string; status: string; judgeModel: string; requestCount: number; submittedAt: string | null; completedAt: string | null
}>> {
  return await db`
    SELECT id, provider, status, judge_model as "judgeModel",
           request_count as "requestCount", submitted_at as "submittedAt", completed_at as "completedAt"
    FROM batches WHERE run_id = ${runId} ORDER BY id
  ` as any[]
}

export async function getPhaseStats(): Promise<Array<{
  phase: string; totalCalls: number; totalCost: number; avgTps: number
}>> {
  return await db`
    SELECT COALESCE(phase, 'unknown') as phase,
           COUNT(*) as "totalCalls",
           ROUND(SUM(cost)::numeric, 4)::float as "totalCost",
           ROUND(AVG(CASE WHEN tokens_per_sec > 0 THEN tokens_per_sec END))::int as "avgTps"
    FROM llm_calls
    GROUP BY phase
    ORDER BY "totalCost" DESC
  ` as any[]
}

let _lintSeeded = false
export async function ensureLintPatterns() {
  if (_lintSeeded) return
  _lintSeeded = true
  await seedLintPatterns()
}
