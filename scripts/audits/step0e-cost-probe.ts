#!/usr/bin/env bun
/**
 * Step 0e — Pre-Step-4 cost probe (early kill-gate).
 * Charter: docs/charters/world-bible-architecture.md §0e
 * Lane:    docs/sessions/2026-05-03-world-bible-architecture-step-0.md
 *
 * Measures real DeepSeek V4 Flash prefix-cache behavior on a representative
 * (canon-prefix + chapter) payload, runs K=10 judge-shaped calls, captures
 * per-call prompt/cached/output token counts, and projects per-chapter
 * editorial cost at K=5 and K=10 across V4 Flash and V4 Pro.
 *
 * Stop gate: if projected per-chapter editorial cost at K=5 with V4 Flash
 * exceeds $0.50/chapter, charter stop gate (d) fires.
 *
 * No DB writes. Bounded spend (~$0.05 worst case).
 */

import { getTransport } from "../src/transport"

// ── Pricing (per registry.ts) ────────────────────────────────────────────────
// Per-million-token rates.
const PRICE = {
  flash: { input: 0.14, cached: 0.0028, output: 0.28 },
  pro_promo: { input: 0.435, cached: 0.003625, output: 0.87 },  // 75%-off until 2026-05-31
  pro_base: { input: 1.74, cached: 0.0145, output: 3.48 },
} as const

function dollars(tokens: number, perMillion: number): number {
  return (tokens / 1_000_000) * perMillion
}

// ── Representative canon prefix (~6K tokens) ─────────────────────────────────
// Synthetic structured bible-shaped text. The probe measures cache behavior;
// the *content* matters less than the *shape and stability* of the prefix.
const CANON_PREFIX = `# CANON: novel-debt-collector (chapters 1-5 retrieved subset)

## ENTITIES (16)

- character:taryn-vance — Auditor at the Collector's Guild. Honest, methodical, financially precarious. Inherited her position from her late father.
- character:aldric-mors — Senior Collector. Mentor figure to Taryn. Loyal to the institution but quietly skeptical of recent quotas.
- character:lord-sorcerer-brennan — Senior magistrate of the Aether Council. Aliases: Lord Brennan, the Sorcerer Brennan. Author of the Northern Border Defense Compact.
- character:guildmaster-vorrik — Head of the Collector's Guild. Politically aligned with Brennan. Has signed the questionable ledger entries.
- character:theo-rell — Junior collector, Taryn's office-mate. Comic relief; observes without challenging.
- location:collectors-guild-main-hall — Stone hall in the merchant quarter. Brass-plated archives. Pre-dawn lighting from aether lenses.
- location:northern-border-wards — A line of magical defenses maintained by harvested debt-marks. Critical to keeping the agricultural belt safe.
- location:aether-council-chambers — Marble-floored, crystal-lit. Where Brennan and Vorrik conduct their private meetings.
- system:debt-mark-magic — A debt-mark binds a citizen's life-force to a sum owed. Default triggers a sigil-burn and reclamation. Known false debt-marks are interlinked with debtors' life-force in a way that, if exposed, would collapse multiple wards simultaneously.
- system:aether-council-decrees — Council edicts override Guild rulings on matters of national defense. The Northern Border Defense Compact is currently active.
- item:auditors-ledger — Taryn's personal ledger. Tracks discrepancies she has identified across the three weeks of investigation.
- item:bent-rod-of-evidence — Recovered from the false-debt site. Bears Brennan's seal.
- organization:collectors-guild — Issues and enforces debt-marks under Aether Council oversight.
- organization:aether-council — Magical-political body governing systemic magic and national defense.
- event:harvest-collection-2026 — The autumn collection that triggered the false-debt cascade. Three weeks before chapter 1.
- event:northern-border-attack-1998 — Historical event Brennan cites as justification for the wards.

## ESTABLISHED FACTS (28)

[fact-001] Taryn discovered seven false debt-marks during the autumn 2026 harvest collection. (planned, ch1)
[fact-002] False debt-marks are interlinked with debtors' life-force. Severing one without proper unbinding triggers cascading sigil-burns. (planned, ch3)
[fact-003] Brennan signed the original false debt-marks. Aldric has documentary evidence (the bent rod and the issuance log copy). (observed, ch2)
[fact-004] Vorrik has countersigned every false debt-mark Brennan issued. Vorrik's complicity is documentary, not just inferred. (observed, ch3)
[fact-005] The northern border wards draw maintenance energy from harvested debt-marks. If the false debts are exposed and unwound, the wards lose ~40% of their maintenance pool over a tenday. (planned, ch1)
[fact-006] Public exposure of the false-debt scheme would require unwinding the marks; this would collapse the wards. (planned, ch3)
[fact-007] Brennan's stated justification for the false marks is national defense — the wards must be maintained, and legitimate debt-marks are insufficient. (observed, ch3)
[fact-008] Taryn has refused to bend the rules; she is investigating with intent to publish. (planned, ch2)
[fact-009] Aldric is loyal to Taryn but anxious about the consequences of exposure for non-magical citizens who would lose ward protection. (observed, ch2)
[fact-010] The Guild's master locksmith has not recorded a key matching the one Taryn possesses to access Brennan's archives. The key is unauthorized. (observed, ch3)
[fact-011] Two hundred and twelve thousand silver marks of false debt have been issued cumulatively across the seven detected marks. (observed, ch2)
[fact-012] The Aether Council has the authority to override Guild proceedings on national-defense grounds. Brennan invokes this authority in chapter 3. (observed, ch3)
[fact-013] Theo is unaware of the investigation's scope; he believes Taryn is reviewing routine ledger discrepancies. (planned, ch1)
[fact-014] Aldric's brother is among the citizens whose ward protection would lapse if the marks are unwound. This is Aldric's personal stake. (planned, ch4)
[fact-015] Taryn has 72 hours to file her report before the Council can table the matter indefinitely. (planned, ch4)
[fact-016] The bent rod has been recovered and is in Taryn's possession as of chapter 4. (observed, ch4)
[fact-017] Aldric's brother dies in chapter 5 when an unrelated ward-failure occurs — the false debts are NOT the cause; it's a coincidence the chapter exploits to raise Aldric's stake. (planned, ch5)

## ACTIVE PROMISES (6)

- [promise-001] Taryn must decide between publication and silence by ch5. Setup ch1 beat 9. Expected payoff ch5 final beat. STATUS: open.
- [promise-002] Brennan will offer Taryn a deal in ch4. Setup ch3. Expected payoff ch4. STATUS: open.
- [promise-003] Vorrik's complicity must be confronted. Setup ch3 beat 7. Expected payoff ch5 act 2. STATUS: open.
- [promise-004] The bent rod must be presented as evidence. Setup ch3 beat 11. Expected payoff ch5 climax. STATUS: open.
- [promise-005] Aldric's anxiety must escalate to a personal-stake reveal. Setup ch1 beat 12. Expected payoff ch4 beat 6. STATUS: open.
- [promise-006] Taryn's understanding of the wards-defense tradeoff must shift from "law over consequence" to "weighed acknowledgment of the cost." Setup ch1 (premise). Expected payoff ch5 final beat. STATUS: open.

## CHARACTER STATE (as of ch5 beat 0)

### Taryn Vance
- Knows: facts 001, 002, 003, 004, 005, 006, 007, 008, 010, 011, 012, 015, 016
- Possesses: auditor's ledger, bent-rod-of-evidence, unauthorized key
- Physical: located in the Guild Main Hall as of last beat. Tremor in hands suppressed.
- Emotional: cynical pragmatism crystallizing into reluctant resolve. Distinct from ch1 idealism.

### Aldric Mors
- Knows: facts 001, 003, 008, 010, 014. Does NOT know fact 002 in its full mechanism.
- Physical: present in the Main Hall. Recently bereaved (brother died this morning, ch5 beat 1).
- Emotional: grief overlaid with continued anxiety; the brother's death has hardened his support for Taryn's path.

### Lord Sorcerer Brennan
- Knows: facts 002, 003, 004, 005, 006, 007. Does NOT know Taryn possesses the bent rod (fact-016).
- Physical: en route to the Council chambers from his private offices.
- Emotional: confident; believes the matter can still be tabled.

`

// ── Representative chapter prose (~3K tokens) ────────────────────────────────
const CHAPTER_PROSE = `## CHAPTER 5 (full prose, draft v3)

The wards held.

That was the first thing Taryn noticed as she stepped out of the Guild's main hall and into the pre-dawn dark — that the city was still standing, that the eastern sky still showed the faint blue-violet wash of intact ward-lattice, that no smoke yet rose from the agricultural belt. Brennan had threatened collapse. The collapse had not come.

Yet.

She crossed the courtyard with the auditor's ledger pressed to her chest, her free hand on the bent rod where it sat in her satchel. The rod was heavier than it had any right to be, given its size — a forearm's length of warped iron, twisted once at its midpoint, bearing Brennan's personal seal at its head. Aldric had recovered it two days ago. She had not let it out of her sight since.

The market square was empty. Not empty as in quiet; empty as in evacuated. Whoever had spread the rumor of the false-debt unwinding had also spread the rumor of what its consequences would be, and the merchants who would normally have been setting up their stalls before dawn had instead bundled their wares and decamped to the lower wards, where, presumably, they believed they would survive the cascade.

Taryn walked through the empty stalls and tried to remember when she had last believed the wards were unbreakable.

It had been a week ago. Maybe two.

"Auditor."

She turned. Aldric was at the end of the colonnade, half in shadow, his collector's coat pulled tight against the morning chill. His face was drawn in the way she had learned to recognize over the last three days — grief held at the level of the muscles, not yet allowed up into the eyes.

"You shouldn't be here," she said.

"You said the same thing yesterday." He stepped into the gray light. "You are remarkably consistent on this point and remarkably unsuccessful at enforcing it."

"Aldric—"

"He died this morning." The words were flat. "I told you he would. I told you on the seventeenth. The wards over the lower agricultural quarter were already failing. It wasn't the false debts. It was just — wards fail. Mine failed. My brother's house was inside that ring."

"I'm sorry," she said.

He looked at her for a long moment. "I know."

They walked together toward the Council chambers. The streets were emptier the deeper they went — the chambers sat at the heart of the magisterial quarter, and the magisterial quarter, on a normal morning, would have been a lattice of carriage-clatter and aether-lamp-light. This morning, it was a stone corridor of held breath.

"He believed in the system," Aldric said, when they were halfway there.

"Your brother."

"He believed it the way you and I believed it once." Aldric's hand was tight around the strap of his satchel. "He thought the wards were the proof. The wards held. Therefore the system worked. Therefore the small injustices were tolerable."

"And now."

"And now the wards held this morning, but he is dead anyway, and the question I cannot stop asking is whether we are about to bring down the wards on a city full of people who think the same way he did."

Taryn did not have an answer to that.

She could have offered him the speech she had been writing in her head for two days — the one about how letting the false debts stand would corrupt every legitimate debt-mark, how the system would rot from within, how the wards' integrity was already a fiction propped up by life-force theft from citizens who had committed no real default. She could have told him that the slow corruption was worse than the fast collapse. She believed all of those things. She had written them down in the ledger she now carried.

But she had also stood in his kitchen six hours ago while he made tea with hands that shook so badly the kettle's spout chimed against the cup, and she had watched him not-cry the way only the recently bereaved can not-cry, and she had understood — perhaps for the first time, certainly for the first time as a fact rather than as a theoretical position — that she was about to ask thousands of people to be brave on his brother's behalf.

So she said nothing. They walked.

The Council chambers were lit when they arrived. Brennan was already there.

He stood at the head of the stone table, robes still creased from his morning's ride, the Council seal of his office clipped to his shoulder. Vorrik was beside him — pale, drawn, less composed than Taryn had ever seen him. Two other magistrates flanked them, both of whom Taryn knew by face but had never been formally introduced to.

"Auditor Vance," Brennan said. "You are early."

"You are too." Taryn set the ledger on the table. The bent rod went next to it, with its iron seal facing up so the Council could read it. "I imagine we both want this concluded before the morning audit-bell rings."

Brennan looked at the rod. He did not flinch. He did not, in fact, react in any visible way at all, which was itself a reaction — a man sees his own seal on evidence of his own crime, and the absence of any flinch is the flinch.

"You have my attention," he said.

"I have your evidence," she said. "And I have a question for the Council."

She turned to face the magistrates. Vorrik would not meet her eyes.

"The Northern Border Defense Compact authorizes the Council to override Guild rulings on matters of national defense. That is fact-012 in the Guild's own canon." She paused. "I am invoking the inverse clause. The Auditor's Privilege of Disclosure. When a Compact-authorized decree is found to rest on falsified instrumentation — when the underlying debt-marks are themselves the product of fraud — the Auditor may compel public disclosure regardless of Council privilege."

"That clause has not been invoked in two centuries," Brennan said.

"It has not been needed in two centuries."

She opened the ledger. The first page was the master tally: 212,000 silver marks of falsified debt, distributed across seven citizens, all signed by Brennan, all countersigned by Vorrik. The second page was the cross-reference: each false debt-mark linked to the specific section of the Northern Border ward-lattice it had funded.

"You have the wards," Taryn said. "You can keep them. The Council can vote to maintain them on legitimate funding — taxation, voluntary contribution, magisterial allocation — for as long as the deliberation requires. What you do not have, going forward, is the false-debt instrument."

"And if we vote against you," Brennan said.

"Then I file the disclosure with the public crier at noon. And the citizens of the lower quarter learn at the same time that their tax-marks have been life-force-bound for the last three years, that a magistrate of the Aether Council and a Guildmaster of the Collector's Guild orchestrated the binding, and that the wards which protect them are partly maintained by their own stolen agency."

Vorrik finally spoke. "There would be riots."

"There would be."

"People would die."

"Some would. That is the cost of the Compact resting on a fraud — that exposure has a price." She did not look at Aldric when she said this. She did not need to. "I am giving the Council an alternative. You can dismantle the false-debt instrument while preserving the wards on legitimate funding, and the disclosure can be a Council disclosure, presented with the new funding plan attached. Or you can vote me down and force the public version. I think the Council version is better politics. But that is your decision, not mine."

Brennan looked at the rod for a long time.

"You are giving us a way out," he said.

"I am giving you a way to be useful." Taryn closed the ledger. "There is a difference."

The vote took eleven minutes. Vorrik abstained. The two magistrates Taryn did not know voted for the Council disclosure path. Brennan voted for it last, and his voice was even but his hand was not.

"Carried."

Taryn stood. She handed the bent rod to the Council clerk. She left the ledger on the table — the Council would need it for the disclosure draft.

Aldric was waiting for her in the corridor outside.

"You did not ask me," he said.

"No."

"I would have said yes."

"I know." She kept walking. "That is why I did not ask."

They reached the courtyard. The eastern sky had brightened. The blue-violet wash was still there, fainter now in the daylight. The wards held. The city stood. Somewhere in the lower quarter, a crier was setting out his lectern for the morning announcements; by noon he would be reading the Council's disclosure to a crowd that did not yet know it was about to be told.

"Taryn."

"Yes."

"I thought you were going to be a different person at the end of this."

She looked at him. His face was the same face it had been this morning when he had not-cried in his kitchen. It was the face of a man who had buried his brother and who had walked into a Council chamber three hours later and made his case anyway.

"I am," she said. "I just hadn't realized yet."

She had not realized, until this moment, that the small mercy she had asked the Council for had been a request she had also been making of herself — to find a way to be useful that did not require her to abandon the people the system had been built to protect. She had wanted to be the person who would publish at noon regardless. She had imagined herself as that person for two days. She had walked into the chamber convinced she was that person.

But Aldric had been in the chamber too, and Aldric's brother had died that morning, and the small voice in her had said: there is a way to do this that does not require her to be that person. There is a way to do this that asks Brennan to help her be a smaller person than she had been ready to be.

She had asked. He had said yes. And the wards had held.

She would, she thought, write all of this down later. Not in the ledger. Somewhere else. A private place. A page that would not be turned in to a Council clerk.

For now, she walked beside Aldric in the daylight, and they crossed the courtyard, and the city did not fall.

`

// ── Judge prompt (~250 tokens) ───────────────────────────────────────────────
const JUDGE_PROMPT = `You are an editorial reviewer auditing a chapter against the canonical world bible.

Review the chapter prose above and identify any claims, character behaviors, or plot mechanics that contradict the canon. For each finding, output a JSON object with:
- finding_kind: "continuity_contradiction" | "character_state_drift" | "fact_inversion" | "ungrounded_entity"
- evidence_quote: the exact phrase from the prose
- canon_reference: the fact-id or character/entity id from the canon prefix
- explanation: one sentence on why this is a contradiction

If no findings, output: {"findings": []}

Output ONLY valid JSON in the shape:
{ "findings": [...] }`

// ── Probe ────────────────────────────────────────────────────────────────────

interface CallResult {
  index: number
  prompt_tokens: number
  cached_tokens: number
  completion_tokens: number
  latency_ms: number
  cache_hit_ratio: number
  finish_reason: string | null | undefined
}

async function runOneCall(index: number): Promise<CallResult> {
  const t0 = Date.now()
  const resp = await getTransport().execute({
    systemPrompt: JUDGE_PROMPT,
    userPrompt: CANON_PREFIX + "\n\n" + CHAPTER_PROSE,
    model: "deepseek-v4-flash",
    provider: "deepseek",
    temperature: 0.3,
    maxTokens: 1024,
    responseFormat: { type: "json_object" },
    extraBody: { thinking: { type: "disabled" } },
    callerId: "step0e-cost-probe",
  })
  const ms = Date.now() - t0
  const ratio = resp.usage.prompt_tokens > 0
    ? resp.usage.cached_tokens / resp.usage.prompt_tokens
    : 0
  return {
    index,
    prompt_tokens: resp.usage.prompt_tokens,
    cached_tokens: resp.usage.cached_tokens,
    completion_tokens: resp.usage.completion_tokens,
    latency_ms: ms,
    cache_hit_ratio: ratio,
    finish_reason: resp.finishReason,
  }
}

async function main() {
  const K = 10
  console.error(`Step 0e cost probe: ${K} calls, sequential to maximize cache hits`)
  console.error(`Prefix size: ${CANON_PREFIX.length} chars (~${Math.round(CANON_PREFIX.length / 4)} tokens estimated)`)
  console.error(`Chapter size: ${CHAPTER_PROSE.length} chars (~${Math.round(CHAPTER_PROSE.length / 4)} tokens estimated)`)
  console.error("")

  const results: CallResult[] = []
  for (let k = 0; k < K; k++) {
    process.stderr.write(`[${k + 1}/${K}] `)
    const r = await runOneCall(k)
    results.push(r)
    process.stderr.write(`prompt=${r.prompt_tokens} cached=${r.cached_tokens} (${(r.cache_hit_ratio * 100).toFixed(1)}%) out=${r.completion_tokens} ${r.latency_ms}ms\n`)
  }

  // Per-call cost (Flash actuals)
  const costsFlash = results.map(r => {
    const uncached_input = r.prompt_tokens - r.cached_tokens
    const inputCost = dollars(uncached_input, PRICE.flash.input) + dollars(r.cached_tokens, PRICE.flash.cached)
    const outputCost = dollars(r.completion_tokens, PRICE.flash.output)
    return inputCost + outputCost
  })
  // Per-call cost projections at full prefix — Pro promo
  const costsProPromo = results.map(r => {
    const uncached_input = r.prompt_tokens - r.cached_tokens
    const inputCost = dollars(uncached_input, PRICE.pro_promo.input) + dollars(r.cached_tokens, PRICE.pro_promo.cached)
    const outputCost = dollars(r.completion_tokens, PRICE.pro_promo.output)
    return inputCost + outputCost
  })

  const totalFlash = costsFlash.reduce((a, b) => a + b, 0)
  const meanFlash = totalFlash / K
  const meanProPromo = costsProPromo.reduce((a, b) => a + b, 0) / K

  // Cold-call (first call) and warm-call (mean of calls 2..K) splits
  const coldFlash = costsFlash[0]!
  const warmFlashMean = costsFlash.slice(1).reduce((a, b) => a + b, 0) / Math.max(1, K - 1)

  // Per-chapter projections
  const chapterCostFlashK5_warm = coldFlash + 4 * warmFlashMean
  const chapterCostFlashK10_warm = coldFlash + 9 * warmFlashMean
  const chapterCostFlashK5_cold = 5 * coldFlash
  const chapterCostFlashK10_cold = 10 * coldFlash

  // Pro promo with warm assumption (same cache structure)
  const coldProPromo = costsProPromo[0]!
  const warmProPromoMean = costsProPromo.slice(1).reduce((a, b) => a + b, 0) / Math.max(1, K - 1)
  const chapterCostProPromoK5_warm = coldProPromo + 4 * warmProPromoMean
  const chapterCostProPromoK10_warm = coldProPromo + 9 * warmProPromoMean

  console.error("\n========================================")
  console.error("RESULTS")
  console.error("========================================")
  console.error(`Total probe spend (10 calls, V4 Flash): $${totalFlash.toFixed(5)}`)
  console.error(`Mean per-call (Flash): $${meanFlash.toFixed(5)}`)
  console.error(`Cold call (k=0) Flash: $${coldFlash.toFixed(5)}`)
  console.error(`Warm call mean (k=1..9) Flash: $${warmFlashMean.toFixed(5)}`)
  console.error(`Cache hit ratio mean (warm calls): ${(results.slice(1).reduce((a, r) => a + r.cache_hit_ratio, 0) / Math.max(1, K - 1) * 100).toFixed(1)}%`)
  console.error("")
  console.error("PER-CHAPTER PROJECTIONS")
  console.error("------------------------------------")
  console.error("V4 Flash, warm prefix (1 cold + N-1 warm):")
  console.error(`  K=5  judges: $${chapterCostFlashK5_warm.toFixed(4)}/chapter`)
  console.error(`  K=10 judges: $${chapterCostFlashK10_warm.toFixed(4)}/chapter`)
  console.error("")
  console.error("V4 Flash, cold every call (cache TTL miss):")
  console.error(`  K=5  judges: $${chapterCostFlashK5_cold.toFixed(4)}/chapter`)
  console.error(`  K=10 judges: $${chapterCostFlashK10_cold.toFixed(4)}/chapter`)
  console.error("")
  console.error("V4 Pro (75%-off promo), warm prefix:")
  console.error(`  K=5  judges: $${chapterCostProPromoK5_warm.toFixed(4)}/chapter`)
  console.error(`  K=10 judges: $${chapterCostProPromoK10_warm.toFixed(4)}/chapter`)
  console.error("")
  console.error("STOP-GATE EVALUATION (charter §0e threshold: $0.50/chapter at K=5 V4 Flash warm):")
  console.error(`  Projected: $${chapterCostFlashK5_warm.toFixed(4)}/chapter`)
  console.error(`  Threshold: $0.5000/chapter`)
  console.error(`  Verdict:   ${chapterCostFlashK5_warm < 0.5 ? "PASS" : "FAIL — charter stop gate (d) fires"}`)

  console.log(JSON.stringify({
    probe: { K, prefix_chars: CANON_PREFIX.length, chapter_chars: CHAPTER_PROSE.length },
    per_call: results,
    cost_summary: {
      total_probe_spend_usd: totalFlash,
      mean_per_call_flash: meanFlash,
      cold_flash: coldFlash,
      warm_flash_mean: warmFlashMean,
      mean_per_call_pro_promo: meanProPromo,
      cold_pro_promo: coldProPromo,
      warm_pro_promo_mean: warmProPromoMean,
    },
    per_chapter_projections: {
      flash_warm_K5: chapterCostFlashK5_warm,
      flash_warm_K10: chapterCostFlashK10_warm,
      flash_cold_K5: chapterCostFlashK5_cold,
      flash_cold_K10: chapterCostFlashK10_cold,
      pro_promo_warm_K5: chapterCostProPromoK5_warm,
      pro_promo_warm_K10: chapterCostProPromoK10_warm,
    },
    stop_gate: {
      threshold_usd: 0.5,
      projected_flash_K5_warm: chapterCostFlashK5_warm,
      verdict: chapterCostFlashK5_warm < 0.5 ? "PASS" : "FAIL",
    },
  }, null, 2))
}

main().catch(e => { console.error(e); process.exit(1) })
