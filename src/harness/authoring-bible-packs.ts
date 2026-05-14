import type { AuthoringBiblePack, AuthoringBibleRule } from "./authoring-bible"

const RILLGATE_CONTRAST_V1: AuthoringBiblePack = {
  id: "rillgate-contrast-v1",
  title: "Rillgate Contrasting Voice Bible",
  description: "Deep Rillgate pack with operational guild-law world pressure and sharply differentiated Kael/Tessa/Orin/Varn voices.",
  storyRules: [
    rule("pack:rillgate-contrast-v1:story:contract-law-wins", "story", "Contract law wins scenes",
      "Important victories should become legal leverage, witness standing, admissible proof, rank movement, or contract pressure; raw courage alone is not enough.",
      "Rillgate scenes involving contracts, rank, witnesses, salvage, proof, debt, or return-to-hub outcomes."),
    rule("pack:rillgate-contrast-v1:story:progression-cost-ledger", "story", "Progression has a ledger",
      "Iron-thread or tactical progress must leave a visible debit: pain, reduced options, owed witness help, damaged gear, legal exposure, or faction attention.",
      "Scenes that use iron-thread binding, a new tactic, rank movement, salvage gain, or survival victory."),
  ],
  worldRules: [
    rule("pack:rillgate-contrast-v1:world:paper-is-weapon", "world", "Paper is a weapon",
      "Guild documents are physical weapons: seals, witness marks, toll logs, rank tokens, salvage clauses, and debt markers should change what characters can claim or safely do.",
      "Contract Hall, gate, hub, return, negotiation, evidence, and witness scenes."),
    rule("pack:rillgate-contrast-v1:world:salt-brine-iron", "world", "Salt, brine, and iron bite",
      "Rillgate texture should feel abrasive and useful: salt dust dries mouths, brine eats skin and gear, iron-thread bites nerves, lamps gutter on wet stone.",
      "Mine, road, contract hall, combat, fatigue, or magic-cost scenes."),
    rule("pack:rillgate-contrast-v1:world:rank-changes-body-language", "world", "Rank changes body language",
      "Rank is visible in who steps aside, who gets named, who signs first, who must pay, and who is allowed to be believed.",
      "Scenes with bronze rank, unranked status, guild rooms, rival crews, clerks, brokers, witnesses, or guards."),
    rule("pack:rillgate-contrast-v1:world:debts-have-handles", "world", "Debts have handles",
      "Debt pressure should appear as transferable markers, stamped notices, sale bells, creditor seals, lodging risk, or legal custody, not only as emotion.",
      "Mira/debt scenes, contract decisions, hub scenes, and return-status scenes."),
  ],
  characterRules: [
    characterRule("pack:rillgate-contrast-v1:char:kael:risk-math", "Kael Rusk", "Kael Rusk risk math",
      "Kael thinks in prices, clauses, bodily costs, exits, witnesses, and leverage. His interiority should sound like tactical accounting under pressure, not open confession."),
    characterRule("pack:rillgate-contrast-v1:char:kael:stress-speech", "Kael Rusk", "Kael Rusk stress speech",
      "Kael speaks clipped and transactional: short sentences, direct refusals, contract shorthand. Under emotion, he names the practical need instead of the feeling."),
    characterRule("pack:rillgate-contrast-v1:char:tessa:line-and-point", "Tessa Mire", "Tessa Mire line-and-point mind",
      "Tessa reads scenes like spear geometry: point, line, distance, footing, openings, and who holds formation. Her choices should test competence before trust."),
    characterRule("pack:rillgate-contrast-v1:char:tessa:dry-cut", "Tessa Mire", "Tessa Mire dry cut",
      "Tessa's voice is controlled and cutting. She uses restrained corrections, rhetorical questions, and the word fine as a warning, not reassurance."),
    characterRule("pack:rillgate-contrast-v1:char:orin:clause-mind", "Orin Vale", "Orin Vale clause mind",
      "Orin turns danger into clauses, admissibility, procedure, and conditional risk. His care shows as precise limits, not heroic declarations."),
    characterRule("pack:rillgate-contrast-v1:char:orin:paper-ritual", "Orin Vale", "Orin Vale paper ritual",
      "Orin's presence should make documents tactile: sanded ink, seal weight, margin notes, ledger columns, careful pauses before a legally dangerous sentence."),
    characterRule("pack:rillgate-contrast-v1:char:varn:velvet-knife", "Lady Varn", "Lady Varn velvet knife",
      "Lady Varn threatens through courtesy. Her questions are commands, her generosity is pricing, and her violence stays hidden inside mutual benefit language."),
    characterRule("pack:rillgate-contrast-v1:char:varn:no-direct-ugliness", "Lady Varn", "Lady Varn no direct ugliness",
      "Lady Varn should rarely name the ugly thing she wants. She talks about satisfactory terms, discretion, opportunity, and unfortunate necessities."),
  ],
  relationshipRules: [
    relationshipRule("pack:rillgate-contrast-v1:rel:kael-tessa:competence-before-trust", "Kael Rusk", "Tessa Mire",
      "Kael and Tessa should move by competence, proof, and witness utility before warmth. Respect appears as tactical coordination before either admits trust."),
    relationshipRule("pack:rillgate-contrast-v1:rel:kael-orin:warning-vs-risk", "Kael Rusk", "Orin Vale",
      "Kael pushes for usable loopholes; Orin supplies limits. Their affection is disguised as warnings, corrections, and refusing to let the other make a legally stupid move."),
    relationshipRule("pack:rillgate-contrast-v1:rel:kael-varn:priced-disposability", "Kael Rusk", "Lady Varn",
      "Kael should sense Varn pricing him as disposable while Varn treats his suspicion as another negotiable term."),
    relationshipRule("pack:rillgate-contrast-v1:rel:tessa-varn:sponsor-snare", "Tessa Mire", "Lady Varn",
      "Tessa's sponsor pressure should make Varn's politeness feel like a snare: Varn never needs to raise her voice because debt already holds the spear."),
  ],
  voiceRules: [
    rule("pack:rillgate-contrast-v1:voice:hardboiled-ledger-fantasy", "voice", "Hardboiled ledger fantasy",
      "The baseline voice should feel like adult mission fantasy with a hard ledger edge: clean physical action, legal pressure, costly magic, and dry restraint.",
      "All Rillgate scenes."),
    rule("pack:rillgate-contrast-v1:voice:dialogue-fingerprints", "voice", "Dialogue fingerprints",
      "Dialogue should make speakers identifiable without tags: Kael clipped and transactional, Tessa pointed and field-aware, Orin conditional and legal, Varn smooth and coercive.",
      "Any scene with two or more named speakers."),
    rule("pack:rillgate-contrast-v1:voice:no-generic-heroic-swelling", "voice", "No generic heroic swelling",
      "Avoid abstract heroic uplift. Let status, debt, blood, seals, brine, rank, witness marks, and changed leverage carry the emotional force.",
      "Action, sacrifice, return, progression, and payoff scenes."),
  ],
}

const PACKS: Record<string, AuthoringBiblePack> = {
  [RILLGATE_CONTRAST_V1.id]: RILLGATE_CONTRAST_V1,
}

export function resolveAuthoringBiblePacks(packIds: readonly string[]): AuthoringBiblePack[] {
  const out: AuthoringBiblePack[] = []
  const seen = new Set<string>()
  for (const id of packIds) {
    const clean = id.trim()
    if (!clean || seen.has(clean)) continue
    const pack = PACKS[clean]
    if (!pack) continue
    seen.add(clean)
    out.push(pack)
  }
  return out
}

export function listAuthoringBiblePacks(): AuthoringBiblePack[] {
  return Object.values(PACKS)
}

function rule(
  id: string,
  kind: AuthoringBibleRule["kind"],
  title: string,
  text: string,
  appliesWhen: string,
): AuthoringBibleRule {
  return {
    id,
    kind,
    title,
    text,
    appliesWhen,
    source: "authoring-bible-pack:rillgate-contrast-v1",
  }
}

function characterRule(id: string, characterName: string, title: string, text: string): AuthoringBibleRule {
  return {
    ...rule(id, "character", title, text, `${characterName} is POV, present, obligated, speaking, thinking, or materially shaping the scene.`),
    characterName,
  }
}

function relationshipRule(id: string, characterName: string, relatedCharacterName: string, text: string): AuthoringBibleRule {
  return {
    ...rule(id, "relationship", `${characterName} / ${relatedCharacterName}`, text, `Both ${characterName} and ${relatedCharacterName} are present or the scene changes their leverage, trust, debt, threat, or witness value.`),
    characterName,
    relatedCharacterName,
  }
}
