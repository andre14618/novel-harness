import type { AuthoringBiblePack, AuthoringBibleRule } from "./authoring-bible"

const RILLGATE_CONTRAST_V1: AuthoringBiblePack = {
  id: "rillgate-contrast-v1",
  title: "Rillgate Contrasting Voice Bible",
  description: "Deep Rillgate pack with operational guild-law world pressure and sharply differentiated Kael/Tessa/Orin/Varn voices.",
  storyRules: [
    rule("pack:rillgate-contrast-v1:story:contract-law-wins", "story", "Contract law wins scenes",
      "Important victories should become legal leverage, witness standing, admissible proof, rank movement, or contract pressure; raw courage alone is not enough.",
      "Rillgate scenes involving contracts, rank, witnesses, salvage, proof, debt, or return-to-hub outcomes.",
      ["contract", "rank", "witness", "salvage", "proof", "debt", "return to hub", "admissible evidence"]),
    rule("pack:rillgate-contrast-v1:story:progression-cost-ledger", "story", "Progression has a ledger",
      "Iron-thread or tactical progress must leave a visible debit: pain, reduced options, owed witness help, damaged gear, legal exposure, or faction attention.",
      "Scenes that use iron-thread binding, a new tactic, rank movement, salvage gain, or survival victory.",
      ["iron-thread", "iron thread", "new tactic", "rank movement", "salvage gain", "survival victory", "damaged gear", "legal exposure"]),
  ],
  worldRules: [
    rule("pack:rillgate-contrast-v1:world:paper-is-weapon", "world", "Paper is a weapon",
      "Guild documents are physical weapons: seals, witness marks, toll logs, rank tokens, salvage clauses, and debt markers should change what characters can claim or safely do. Example texture: the seal weight changes who is believed.",
      "Contract Hall, gate, hub, return, negotiation, evidence, and witness scenes.",
      ["contract", "contract hall", "seal", "witness mark", "toll log", "rank token", "salvage clause", "debt marker", "evidence", "witness"]),
    rule("pack:rillgate-contrast-v1:world:salt-brine-iron", "world", "Salt, brine, and iron bite",
      "Rillgate texture should feel abrasive and useful: salt dust dries mouths, brine eats skin and gear, iron-thread bites nerves, lamps gutter on wet stone. Example texture: salt on the tongue makes the cost physical.",
      "Mine, road, contract hall, combat, fatigue, or magic-cost scenes.",
      ["salt dust", "brine", "iron-thread", "iron thread", "wet stone", "mine", "combat", "fatigue", "magic cost"]),
    rule("pack:rillgate-contrast-v1:world:rank-changes-body-language", "world", "Rank changes body language",
      "Rank is visible in who steps aside, who gets named, who signs first, who must pay, and who is allowed to be believed. Example texture: a clerk looks at the token before the face.",
      "Scenes with bronze rank, unranked status, guild rooms, rival crews, clerks, brokers, witnesses, or guards.",
      ["bronze rank", "unranked", "rank token", "guild room", "clerk", "broker", "witness", "guard"]),
    rule("pack:rillgate-contrast-v1:world:debts-have-handles", "world", "Debts have handles",
      "Debt pressure should appear as transferable markers, stamped notices, sale bells, creditor seals, lodging risk, or legal custody. Example texture: a sale date turns fear into a deadline.",
      "Mira/debt scenes, contract decisions, hub scenes, and return-status scenes.",
      ["debt", "marker", "stamped notice", "sale bell", "creditor seal", "lodging risk", "legal custody", "sale date"]),
  ],
  characterRules: [
    characterRule("pack:rillgate-contrast-v1:char:kael:risk-math", "Kael Rusk", "Kael Rusk risk math",
      "Kael converts fear into price, deadline, witness, leverage, bodily cost, and exit math. Example: \"Four days. No witness. One patron with clean registration.\""),
    characterRule("pack:rillgate-contrast-v1:char:kael:stress-speech", "Kael Rusk", "Kael Rusk stress speech",
      "Kael speaks clipped and transactional: short sentences, direct refusals, contract shorthand. Example: \"Name the price. Then the catch.\""),
    characterRule("pack:rillgate-contrast-v1:char:tessa:line-and-point", "Tessa Mire", "Tessa Mire line-and-point mind",
      "Tessa reads scenes like spear geometry: point, line, distance, footing, openings, and who holds formation. Example: \"Your point is open. Fix it before you speak.\""),
    characterRule("pack:rillgate-contrast-v1:char:tessa:dry-cut", "Tessa Mire", "Tessa Mire dry cut",
      "Tessa's voice is controlled and cutting. She uses restrained corrections and field-aware questions. Example: \"Fine. Bleed on your own side, then.\""),
    characterRule("pack:rillgate-contrast-v1:char:orin:clause-mind", "Orin Vale", "Orin Vale clause mind",
      "Orin turns danger into clauses, admissibility, procedure, and conditional risk. Example: \"I did not say safe. I said admissible.\""),
    characterRule("pack:rillgate-contrast-v1:char:orin:paper-ritual", "Orin Vale", "Orin Vale paper ritual",
      "Orin's presence should make documents tactile: sanded ink, seal weight, margin notes, ledger columns, careful pauses. Example: he answers after blotting the line."),
    characterRule("pack:rillgate-contrast-v1:char:varn:velvet-knife", "Lady Varn", "Lady Varn velvet knife",
      "Lady Varn threatens through courtesy. Her questions are commands, her generosity is pricing, and her violence stays inside mutual benefit language. Example: \"How fortunate that your desperation is so punctual.\""),
    characterRule("pack:rillgate-contrast-v1:char:varn:no-direct-ugliness", "Lady Varn", "Lady Varn no direct ugliness",
      "Lady Varn names satisfactory terms, discretion, opportunity, and unfortunate necessities. Example: \"Let us call it an opportunity before someone less polite calls it debt.\""),
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
      "Let status, debt, blood, seals, brine, rank, witness marks, and changed leverage carry the emotional force.",
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
  selectionHints: string[] = [],
): AuthoringBibleRule {
  return {
    id,
    kind,
    title,
    text,
    appliesWhen,
    source: "authoring-bible-pack:rillgate-contrast-v1",
    ...(selectionHints.length > 0 ? { selectionHints } : {}),
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
