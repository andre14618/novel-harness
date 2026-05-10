---
job: 3
title: Method Pack Factory and Synthetic Golden Examples
date: 2026-05-10
model: opus
status: draft (decision artifact, not promotion-ready)
---

# Method Pack Factory and Synthetic Golden Examples

This document is a decision artifact. It does not change runtime behavior. It
proposes 7 new method packs (genre-scoped planner contracts) plus 11 synthetic
outline-level golden examples that an operator can review against the
Plan-Readiness rubric before any of these packs is wired into the planner.

## Scope and Constraints

- Each pack is planner-consumable: it constrains chapter/scene contracts using
  fields the planner schemas already know how to emit (`structureSlotId`,
  `chapterFunction`, `endpointOrHook`, `goal/conflict/turn/outcome/consequence`,
  `requiredObligationIds`, `establishedFacts`, etc.) plus the lightweight
  diagnostic overlays defined in CFA v1 (`strategyPacketId`, `storyDebtId`,
  `valueIn/valueOut`).
- Examples are **outline-level only.** No prose paragraphs imitating any
  author. Beat lists, scene functions, payoff links, value charges only.
- Packs are diagnostic-only by default. Promotion to a runtime planner default
  requires the same evidence path CFA v1 declared: planner-only diagnostic on
  frozen concepts, blind pairwise judge runs, operator side-by-side review,
  then a small framework-to-prose POC.
- Reference shape is `docs/method-packs/commercial-fantasy-adventure-v1.md`.
- Where this doc disagrees with code/runtime, code wins per CLAUDE.md.

## Why CFA v1 Is Not Re-Done As v2 Here

CFA v1 already encodes the strategy packet, flexible commercial slots, scene
contracts, character materiality overlay, and planner-owned story debt at a
genre-neutral level. The remaining v1 weaknesses (Story Grid genre obligations
not enforced, MICE-stack discipline absent, no concrete promise scale-match
check, no end-of-arc landing rubric beyond `endpointLanding`) are better
addressed as **cross-pack diagnostics** (see Recommendations) than as a
v2 rewrite of the genre-neutral pack itself. A v2 should follow only after at
least two genre-specific packs in this doc clear the same evidence gate v1
declared and reveal a real shared deficiency.

## Cross-Pack Conventions (apply to every pack)

Unless a pack explicitly overrides them.

- **Slot ID prefix.** Each pack uses a 3-letter prefix (`PFA`, `EPI`, `THF`,
  `CMF`, `LRP`, `RMT`, `HST`) followed by a two-digit slot number. Slots are
  story jobs, not chapter mandates; they may merge or split.
- **Strategy packet.** All packs require the v1 packet
  (`logline`, `paragraphSummary`, `majorReversals[]`, `endingDirection`,
  `readerPromise`, `protagonistWant`, `protagonistNeed`, `protagonistLie`,
  `protagonistTruth`, `antagonistPressure`, `worldPressureRule`).
- **Scene contract.** All packs use the v1 Story Grid scene contract
  (`goal`, `opposition`, `turningPoint`, `crisisChoice`, `climaxAction`,
  `resolution`, `valueIn`, `valueOut`, `consequence`).
- **Story debt fields.** All packs use `storyDebtId`, `promiseText`,
  `openedBySlotId`, `expectedProgressSlotIds[]`, `expectedPayoffSlotId`,
  `payoffPolicy`.
- **Pack-specific extension.** Each pack adds 0-6 fields to the strategy
  packet or scene contract for its genre's load-bearing artifacts (e.g., LRP
  adds `progressionLadder`; CMF adds `clueLedger`). Extensions are listed in
  each pack's "Pack-specific schema overlay" section.
- **Diagnostic-only.** No pack changes writer prompts, checker thresholds, or
  runtime defaults until it clears the v1 evidence gate.

---

## Method Pack Index

| Pack | Genre family | Distinctive constraint |
| --- | --- | --- |
| PFA v0 | Portal Fantasy | Disorientation budget + threshold-of-no-return locked at slot PFA-08; Earth-knowledge inventory drives ingenuity payoffs. |
| EPI v0 | Epic Fantasy (multi-POV) | Per-POV Snowflake packet + POV-collision schedule; convergence chapters are planner-mandated, not improvised. |
| THF v0 | Thriller Fantasy | Antagonist-clock manifest with monotonically tightening deadline + magic-cost gate on every escape. |
| CMF v0 | Cozy Mystery Fantasy | Clue ledger with red-herring/lie/payoff trios; emotional-stakes axis runs in parallel to the whodunit. |
| LRP v0 | Progression / LitRPG | Progression ladder + power-creep budget + level-up cadence schedule + system-voice exemplars. |
| RMT v0 | Romantasy | Dual emotional/external spines, paired beats interlocked at five named slots; relationship value-charge required per scene. |
| HST v0 | Heist Fantasy | Crew-role roster + setup-reveal-twist accounting (every reveal must have an earlier setup beat with a stable IDs link). |

Two genres requested in the prompt (Grimdark, Sword & Sorcery / Pulp) are
handled at smaller scope as **modifier packs** in §11 — they are tonal
overlays better expressed as a flag on top of CFA v1 or EPI v0 than as
standalone packs at this stage. This is justified in §11.

---

## Method Pack: Portal Fantasy v0

### Identity

- **Genre family:** Portal Fantasy. Earth (or mundane) protagonist transported
  into a secondary fantasy world. Includes isekai (one-way), gateway (two-way),
  and "summoned hero" subtypes.
- **Reader contract:** *I will see a recognizable everyperson learn to operate
  a strange world; my own ordinariness will be re-cast as latent capability.*
- **Disqualifying violations:**
  - Protagonist is competent at the new world's rules within ~10% of book.
  - World pressure exists but never causally hits Earth-knowledge.
  - Threshold crossing is reversible in the first half.
  - "Why this person?" is never answered (concrete, even if mystical).
  - Hero refuses adaptation through the climax (different from refusing
    return — which is allowed and often genre-correct).

### Parameters (planner inputs)

| Parameter | Default | Notes |
| --- | --- | --- |
| Chapter count | 22-28 | Compresses portal/threshold pre-roll vs. CFA. |
| Word count target | 95k-115k | KU-ready single volume. |
| POV mode | Single (protagonist) | Multi-POV breaks the disorientation contract early. |
| Magic system stance | Hard for first read, soft thereafter | Reader needs cost-of-power demo by midpoint. |
| Romance weight | None to B-plot | A-plot romance flips this to RMT v0. |
| Mortality stance | Pulp-safe to realistic | Grimdark variant must override Disorientation slot rules. |
| Return stance | required | one of {one-way, two-way, ambiguous-return}. Drives ending. |
| Earth-knowledge stance | required | one of {tech, scholarly, athletic, social, low}. Drives competence-spike payoffs. |

### Pack-specific schema overlay

Adds these to the v1 strategy packet:

- `returnStance` — enum above.
- `earthKnowledgeInventory[]` — list of `{name, originDomain, expectedPayoffSlotIds[]}`.
  This is the protagonist's pre-portal toolkit; each item should fire at least
  once and at most twice in the book unless the planner declares it a series
  thread.
- `worldRulesetSummary` — one paragraph summarizing the destination world's
  operating rules. The planner conserves this packet.

### Chapter-function template

| Slot | Function | Required scene action | Character pressure | World pressure | Promise made/repaid | Diagnostic if missing |
| --- | --- | --- | --- | --- | --- | --- |
| PFA-01 | Earth baseline | Protagonist exhibits a specific competence and a specific deficit at home. | Want vs. perceived ceiling. | None (Earth context only). | "This person's ordinariness will become legible." | `endpointLanding`, `characterMateriality`. |
| PFA-02 | Disturbance signal | A subtle world-leak event (object, dream, anomaly, summons text). | Doubt + curiosity. | First world-leak. | Setup: portal mechanics. | `worldRelevance` if leak is decoration not foreshadow. |
| PFA-03 | Refusal of strangeness | Protagonist tries to rationalize the leak away. | Lie reinforced. | Leak escalates. | Setup: lie under load. | `arcStatePerBeat`. |
| PFA-04 | Forced threshold | Crossing happens to the protagonist (not chosen yet). | Helplessness. | New-world physics violently presents. | Open: "How will this person operate here?" | `causalMomentum`. |
| PFA-05 | Disorientation walk | First exposure to the new world's basic operating rules. | Sensory overload + survival. | Operative ruleset emerges. | Setup: world ruleset. | `proseReadiness` if exposition without dramatization. |
| PFA-06 | First competence flicker | An Earth-knowledge item is recontextualized and useful. | Surprise mastery. | World accepts this knowledge. | Repaid: "ordinariness as capability" (first instance). | `worldAsEngine` if Earth tool is decorative. |
| PFA-07 | Found-allyship contract | Protagonist binds to ally(ies) under a specific obligation. | Social leverage / debt. | Social rules constrain. | Open: alliance debt. | `relationshipMovement`. |
| PFA-08 | Threshold of no return | Return is locked off, sealed, or made conditional on success. | Grief / commitment. | Return path encoded. | Open: "Will/should they return?" | **Pack-defining slot. If missing or weak, the pack has failed. Halt promotion.** |
| PFA-09 | Operating rules test | A scene where mishandling the rules costs something concrete. | Misjudgment paid for. | Rules bite. | Setup: cost-of-power demo. | `worldAsEngine`. |
| PFA-10 | Earth-knowledge synergy | Two inventory items combine for a non-trivial advantage. | Build identity emerges. | World rule + Earth tool combine. | Repaid: "ordinariness as capability" (second instance). | `causalMomentum`. |
| PFA-11 | Reframed objective | Protagonist names what they are actually doing here, distinct from initial summons. | Want shifts; need surfaces. | World stakes named. | Open: revised promise. | `endpointLanding` ripple. |
| PFA-12 | Mid-book reversal | The wrong assumption about the world / summons is publicly broken. | Lie cracks. | World was lying. | Setup: third-act recontextualization. | `causalMomentum` if reversal is informational not consequential. |
| PFA-13 | Cost of staying | A relationship, identity, or Earth tie is paid as the price of continuing. | Grief, conviction. | World demands a real cost. | Repaid (partial): commitment cost. | `arcStatePerBeat`. |
| PFA-14 | Antagonist shape clarified | Antagonist's plan and the protagonist's role in it become explicit. | Stakes named. | Antagonist's world-leverage demonstrated. | Setup: confrontation. | `worldAsEngine`. |
| PFA-15 | Return path complication | Whatever the protagonist thought was the way home is no longer simple. | Forced choice clarified. | Return costs something different. | Open: ending shape. | `endpointLanding` flag if ending shape unclear. |
| PFA-16 | False victory or false return | A version of "winning" or "going home" is accepted, then revealed inadequate. | Old want fulfilled, found empty. | World pays partial. | Repaid (subverted): want vs. need. | `causalMomentum`. |
| PFA-17 | Forced truth | Protagonist names their lie, the world's lie, and the actual ask. | Lie collapses. | World pressure named. | Repaid: lie/truth. | `characterMateriality`. |
| PFA-18 | Recommitment | Protagonist chooses how to operate (stay/return/integrate) on revised terms. | Need accepted. | World accepts the new terms. | Open: defining choice. | `arcStatePerBeat`. |
| PFA-19 | Ally network test | Earlier alliances are tested and either honored or revealed false. | Social leverage settled. | Social rules bite back. | Repaid: alliance debts. | `relationshipMovement`. |
| PFA-20 | Final approach | Plan is set; cost is named; Earth-knowledge inventory is committed. | Resolve under named cost. | World rules constrain plan. | Setup: Earth-tool payoff. | `proseReadiness`. |
| PFA-21 | Magic-cost climax | Climax that pays off the magic system AND the Earth-knowledge synergy together. | Defining choice executed. | World pays decisive turn. | Repaid: cost-of-power. | `worldAsEngine`. **Hard slot.** |
| PFA-22 | Defining choice | The protagonist's choice is the one only this person, with this Earth-knowledge, with this lie/truth, could make. | Want vs. need resolved. | World accepts choice as load-bearing. | Repaid: reader contract. | `characterMateriality`, `endpointLanding`. |
| PFA-23 | Return / integration consequence | The chosen return-stance plays out concretely. | Loss & gain named. | World is changed by the choice (if applicable). | Repaid: returnStance promise. | `endpointLanding`. |
| PFA-24 | Final image / next promise | Last image shows the protagonist's new ordinary; next-book hook (if any) names a still-open Earth/world tension. | Quiet coda. | World post-choice depicted. | Setup (series): next ask. | `proseReadiness`. |

### Scene contract

- **Dramatic completeness:** v1 Story Grid contract. Plus: every scene in
  slots PFA-04 through PFA-08 must include a `worldRuleEncountered`
  obligation linking to a `worldFactId` in `worldRulesetSummary`.
- **Value charge:** scenes in PFA-01 through PFA-04 trend negative or mixed
  (disorientation phase). PFA-06, PFA-10, PFA-21 must close positive on
  `power-weakness` or `success-failure` axis. PFA-13, PFA-16 must close
  negative on `belief-doubt` or `identity-unknown`.
- **MICE thread:** a Milieu thread opens at PFA-04 and must close at PFA-23.
  An Idea/Inquiry thread opens at PFA-02 ("why this person?") and closes at
  PFA-17. Character thread opens at PFA-01 and closes at PFA-22. Any extra
  threads must close before the threads they depend on.
- **Promise/payoff bookkeeping:** every `earthKnowledgeInventory` item gets a
  `storyDebtId`. Items unused at PFA-22 are flagged unless explicitly carried
  forward as a series thread.

### Character pressure rules

- **Want vs. need:** want is usually framed as "get home" or "succeed at the
  summons task"; need is almost always framed as "earn agency in a world that
  did not consult you" or "stop confusing competence with ordinariness."
- **Agency floor:** by PFA-08, the protagonist must have made one
  consequential choice (not one that was made for them). Failing this, the
  pack has failed.
- **Relationship movement:** at least two named relationships move through
  one full state-change each (stranger → ally OR ally → tested OR ally →
  betrayed) by PFA-19. Romance is allowed but not required.

### Worldbuilding pressure rules

- **New-element introduction cadence:** one *operating rule* introduced per 2
  chapters in slots PFA-04 through PFA-09; one per 3 chapters thereafter. No
  new operating rules introduced after PFA-19 (Brooks's hardest deterministic
  rule).
- **Cost-of-magic:** by PFA-09 the protagonist must have witnessed at least
  one concrete cost of power (someone paying the price, including the
  protagonist or an ally). PFA-21 is the climactic cost-of-magic demo.
- **Earth-knowledge inventory cadence:** at least one inventory item used per
  ~5 chapters. No item appears for the first time after PFA-19.

### Diagnostics (semantic judges)

Extends the v0 method-pack judge prompt with five pack-specific checks:

1. `disorientationLanding`: Does PFA-04 force, not invite, the threshold?
   Does PFA-08 actually lock off return? Pass if both close negative on
   `freedom-slavery` or `identity-unknown` axis.
2. `earthKnowledgeMaterial`: Does each `earthKnowledgeInventory` item appear
   in at least one scene where its absence would change the outcome?
3. `competencePace`: Does protagonist remain credibly out of their depth at
   least through PFA-09? (Genre is broken when protagonist is "fish in
   ocean" by chapter 3.)
4. `returnPathLogic`: Is the return path established before PFA-15 and
   complicated, not invented, at PFA-15?
5. `worldRulesetConservation`: Does the final plan reference rules that were
   established by PFA-09 (or earlier), or does it invent a new rule to win?

### Anti-patterns

- "Trains-and-textbook" exposition: ruleset dumped through dialogue with no
  scene work.
- Instant competence: protagonist absorbs language/customs/magic in a
  montage chapter.
- Frictionless allyship: first ally trusts protagonist immediately and never
  has cause to reconsider.
- Earth-knowledge as deus ex machina: an unestablished knowledge appears
  exactly when needed.
- Return as afterthought: ending decides return-stance with no earlier setup.
- Summoner amnesia: the antagonist who summoned the protagonist disappears
  for 18 chapters and re-enters at climax.
- "I'm here for a reason" reveal that adds no constraint.
- Earth as hell, world as paradise (or vice versa) without ambivalence.

### Synthetic golden examples

**Example PFA-A.** Subgenre: contemporary-portal isekai. Length: 24-chapter
spine. POV: single. Completeness: full spine, slot map only.

| Slot | Chapter | Scene function | Promise/payoff |
| --- | --- | --- | --- |
| PFA-01 | 1 | Civil engineer (protagonist Mara) presents a bridge fault report; superiors override her on cost grounds. | Open: "competence-vs-permission" |
| PFA-02 | 1 | Mara's coffee cup steams a sigil on the windowpane. | Open: portal-leak |
| PFA-03 | 2 | Mara double-checks her calculations against the fault, ignores the sigil. | Continuation: lie ("I am not someone things happen to") |
| PFA-04 | 3 | The bridge fails during inspection; Mara falls; lands in a stone-walled keep. | Open: world-mystery; Repaid: portal-leak |
| PFA-05 | 4 | Keep guards interrogate Mara in an unknown language; she draws diagrams. | Open: world-ruleset |
| PFA-06 | 5 | Captain notices her diagram understands the keep's load-bearing arch better than their own master mason. | Repaid: competence-vs-permission (first) |
| PFA-07 | 6 | Captain offers Mara housing in exchange for examining a watchtower that's been "weeping" stone. | Open: alliance-debt-Captain |
| PFA-08 | 7 | The portal closes; the priest-king who summoned Mara dies in the night, sealing the only return path. | Repaid: portal-leak; Open: return-impossible |
| PFA-09 | 8 | Mara orders a guard to brace a wall using the mason's traditional technique; it fails because the world's mortar has different tensile properties. A guard is injured. | Repaid: cost-of-power (first); Setup: rule-bites |
| PFA-10 | 9 | Mara combines her field-engineering safety protocols with the local mortar's properties to retrofit the watchtower. | Repaid: competence-vs-permission (second) |
| PFA-11 | 10 | Mara learns the priest-king summoned her not as a hero but as a *witness* to a cathedral collapse he expected. She reframes her objective. | Open: revised-promise; Repaid (partial): "why this person" |
| PFA-12 | 11 | The cathedral has not collapsed because someone has been sabotaging the saboteur — pointing at a faction Mara hadn't considered. | Repaid (subverted): summons motive |
| PFA-13 | 12 | Mara learns her sister on Earth was already dead at the time of her crossing; her grief, paradoxically, ends her wish to return. | Repaid: cost-of-staying |
| PFA-14 | 13 | The antagonist is named: the surviving regent who ordered the cathedral built to fail, to consolidate power. | Open: confrontation |
| PFA-15 | 14 | A second portal-rite is possible but would require the cathedral itself to fall, killing the people inside. | Open: ending-shape (return-or-save) |
| PFA-16 | 15 | Mara nearly chooses to return; the captain confronts her and she stays. | Repaid (subverted): want-vs-need |
| PFA-17 | 16 | Mara names her lie aloud: she has spent her life saying yes to authority over evidence. | Repaid: lie/truth |
| PFA-18 | 17 | Mara writes a structural plan to brace the cathedral so it survives the regent's sabotage. | Open: defining-choice-plan |
| PFA-19 | 18 | The captain is revealed to have his own debt to the regent; he chooses Mara. | Repaid: alliance-debt-Captain |
| PFA-20 | 19 | Mara assembles materials, masons, and guards. Cost is named: the bracing will weaken the cathedral permanently. | Setup: cost-of-magic-climax |
| PFA-21 | 20 | The regent attacks during bracing; Mara executes the brace using a high-school physics mnemonic; the cathedral holds. | Repaid: cost-of-power (climactic) |
| PFA-22 | 21 | The regent demands Mara accept a position; Mara refuses on a principle she could not have named in chapter 1. | Repaid: reader-contract |
| PFA-23 | 22 | The portal-rite remains available; Mara declines it. | Repaid: return-stance (one-way by choice) |
| PFA-24 | 23 | Mara walks the keep at dawn; she notices a structural flaw in a tower no one has reported. | Setup: series-promise |

Promise/payoff trace: 6 named promises, all repaid. No new entities post-PFA-19.
Earth-knowledge items used: 4 (engineering codes, mortar tensile properties,
high-school physics mnemonic, project-management framing). 0 inventory items
unused.

**Example PFA-B.** Subgenre: summoned-hero classic. Length: single chapter
beat plan (~3 scenes). Completeness: chapter-level only.

Chapter (PFA-08 slot, "Threshold of no return"):

- Scene 1 (`goal`: protagonist negotiates leaving the summoner's tower;
  `opposition`: summoner's seneschal; `turningPoint`: protagonist learns the
  summons is one-way only as long as the summoner lives; `crisisChoice`:
  trust the summoner enough to learn how he dies, or attempt the rite alone;
  `climaxAction`: agree to a year of service; `resolution`: door is sealed
  behind protagonist with a sigil that fades over a year. `valueIn`:
  freedom; `valueOut`: slavery (committed). `consequence`: a literal
  countdown begins.)
- Scene 2 (`goal`: meet the field commander who will train protagonist;
  `opposition`: commander dismisses Earth credentials; `turningPoint`:
  commander tests protagonist with a tactical map and protagonist solves it
  by treating it as a logistics problem; `crisisChoice`: commander accepts
  protagonist as auxiliary, not soldier; `climaxAction`: protagonist accepts
  the demotion; `resolution`: protagonist is given a token of conditional
  trust. `valueIn`: status; `valueOut`: lower status, higher leverage.
  `consequence`: alliance-debt-Commander opened.)
- Scene 3 (`goal`: alone, protagonist examines the sigil on the door;
  `opposition`: the sigil's behavior contradicts the seneschal's
  explanation; `turningPoint`: protagonist realizes the summons mechanics
  were misrepresented; `crisisChoice`: confront seneschal now or build
  evidence; `climaxAction`: build evidence; `resolution`: protagonist hides
  a journal entry. `valueIn`: belief; `valueOut`: doubt. `consequence`:
  Idea/Inquiry thread opens — "what was actually summoned, and why this
  person?")

---

## Method Pack: Epic Fantasy v0

### Identity

- **Genre family:** Epic Fantasy with multi-POV cast, large-scale stakes
  (kingdom/world/cosmological), and set-piece chapter cadence. References:
  Sanderson's Stormlight, Jordan's Wheel of Time, GRRM, Williams's *Memory
  Sorrow Thorn*, Erikson's *Malazan*. Not interchangeable with single-POV
  high-fantasy adventure (which stays on CFA).
- **Reader contract:** *I will follow several lives whose decisions, made
  at distance, converge into a single load-bearing event whose stakes are
  larger than any one of them.*
- **Disqualifying violations:**
  - All POVs are in the same place / same plotline (then it's not multi-POV
    epic, it's CFA with extra POVs).
  - POVs never converge or never causally influence each other.
  - Cosmological stakes are introduced but not paid off (or vice versa).
  - One POV is so dominant that others read as decorative.
  - The "epic" scale is asserted but never dramatized at scale.

### Parameters (planner inputs)

| Parameter | Default | Notes |
| --- | --- | --- |
| Chapter count | 50-90 | Often 60-80 for a single-volume epic; longer for series. |
| Word count target | 180k-300k | Large-volume single book; series volumes can run higher. |
| POV mode | 3-7 named POVs | <3 is dual-POV CFA; >7 risks mosaic incoherence. |
| Magic system stance | Hard or hybrid | Hard preferred; cosmological rules conserved. |
| Romance weight | None to B-plot per POV | A-plot per POV flips that POV to RMT v0 sub-rules. |
| Mortality stance | realistic to grimdark | Grimdark variant tightens cost-realism. |
| POV mode shape | required | linear-rotation, weighted-rotation, or convergence-pyramid. |
| Convergence count | required (1-3) | Hard convergence chapters (multiple POVs in one chapter or adjacent chapters culminating in shared event). |

### Pack-specific schema overlay

- `povRoster[]` — list of `{povId, name, role, ownStrategyPacket}`. Each POV
  gets its own v1 strategy packet (logline, want, need, lie, truth, etc.). The
  novel-level packet is a synthesis, not a sum.
- `povRotationPattern` — enum of {linear, weighted, convergence-pyramid}.
- `convergenceSlots[]` — list of slot IDs where ≥2 POVs share scenes or
  consequences in the same chapter.
- `cosmologicalStakeStatement` — one sentence on what is at stake at the
  largest scale, with explicit specification of which POVs are aware of it.

### Chapter-function template

Slots are story jobs at the **novel level**; per-POV the planner shadows them
with sub-slots `EPI-NN.<povId>`. All POVs have at least one slot of each major
function.

| Slot | Function | Required scene action | Character pressure | World pressure | Promise made/repaid | Diagnostic if missing |
| --- | --- | --- | --- | --- | --- | --- |
| EPI-01 | World-orientation opener (single POV) | Establish operating world rules and emotional anchor. | One POV's pressure baseline. | Operative ruleset shown. | Open: "this world's stakes." | `endpointLanding`. |
| EPI-02 | Disturbance, POV A | Inciting event localized to POV A. | A's want surfaces. | World's pressure point #1. | Open: thread A. | `worldAsEngine`. |
| EPI-03 | Disturbance, POV B | Inciting event localized to POV B; *seemingly unrelated* to POV A. | B's want surfaces. | World's pressure point #2. | Open: thread B. | `causalMomentum`. |
| EPI-04 | Disturbance, POV C (or remaining POVs) | Same; threaded across remaining POVs. | Each POV's want. | More pressure points. | Open: threads C+. | Same. |
| EPI-05 | First cross-POV echo | Two POVs' threads share a fact, name, or consequence (without meeting). | Reader notices coupling; characters do not. | World pressure couples threads. | Setup: convergence #1. | `worldRelevance`, `causalMomentum`. |
| EPI-06 | Antagonist proof of scope | A scene from villain or villain-aligned POV demonstrates antagonist's reach. | Reader-level dread. | Antagonist's world-leverage shown. | Open: antagonist plan. | `worldAsEngine`. |
| EPI-07 | First plot point per POV | Each POV crosses an irreversible threshold within their thread. | Each lie strained. | World forces commitment. | Open: per-POV story-debts. | `arcStatePerBeat`. **Hard slot.** |
| EPI-08 | Set-piece I (battle/ritual/court) | A planner-mandated set-piece with at least 2 POVs. | Stakes named. | World rules dramatized at scale. | Setup: cosmological stakes. | `proseReadiness`. **Hard slot.** |
| EPI-09 | Convergence #1 | Two or more POV threads physically intersect or causally collide. | Each POV recognizes the others matter. | World pressure rotates. | Repaid (first): cross-POV coupling. | `causalMomentum`. **Hard slot.** |
| EPI-10 | Pinch / set-piece II | Antagonist's first major win against the protagonist coalition. | Coalition lie cracks. | World pays a cost (territory, life, knowledge). | Open: revised plan. | `worldAsEngine`. |
| EPI-11 | Midpoint reframe | Cosmological stakes are revealed/expanded; coalition's working theory is wrong. | Lie cracks across POVs. | World scale shifts up. | Repaid (subverted): coalition theory. | `endpointLanding`. **Hard slot.** |
| EPI-12 | Per-POV recommitment | Each POV publicly recommits or defects, on revised terms. | Need surfaces per POV. | World accepts new terms. | Open: per-POV defining choice. | `arcStatePerBeat`. |
| EPI-13 | Cosmological pressure operationalized | A piece of the cosmological stake hits one POV directly (a death, a magic-system manifestation, a prophecy). | Stakes felt, not asserted. | World rule activated. | Repaid (partial): cosmological stake. | `worldAsEngine`. **Hard slot.** |
| EPI-14 | Set-piece III | Set-piece tied to the antagonist's plan moving forward. | Coalition's resources spent. | World's rules pay turn. | Setup: gauntlet. | `proseReadiness`. |
| EPI-15 | Convergence #2 | Most POVs converge or commit to a convergence path. | Cross-POV trust tested. | World forces convergence. | Repaid: cross-POV coupling (full). | `causalMomentum`. **Hard slot.** |
| EPI-16 | Final approach, multi-POV | Coalition assembles plan; per-POV cost named. | Each POV commits to a personal cost. | World rules constrain plan. | Setup: climactic confrontation. | `endpointLanding`. |
| EPI-17 | Climactic confrontation | The set-piece climax. May span 2-4 chapters. | Defining choices executed across POVs. | Cosmological stakes pay decisive turn. | Repaid: cosmological stake (full). | `worldAsEngine`. **Hard slot.** |
| EPI-18 | Per-POV consequence | Each POV's lie/truth resolution is dramatized in a quiet scene. | Per-POV need accepted or rejected. | World post-climax depicted. | Repaid: per-POV story debts. | `characterMateriality`. **Hard slot.** |
| EPI-19 | World-after epilogue | World's new shape shown; new tension named (series) or closed (single-volume). | Coda. | World post-climax depicted. | Open or Repaid: series-promise. | `endpointLanding`. |

### Scene contract

- **Dramatic completeness:** v1 contract. Plus: every scene declares
  `povCharacterId` and a `convergenceFlag` boolean (true iff scene uses ≥2
  POV characters' material in active conflict).
- **Value charge:** convergence chapters must close with a polarity shift
  on `power-weakness` or `life-death` axis. Per-POV "dark night" scenes
  (around EPI-12) must close negative on `belief-doubt` or `hope-despair`.
- **MICE thread:** Idea/Inquiry threads dominate the cosmological-stake
  spine. Milieu threads dominate per-POV "where am I and what does this
  place do" arcs. Each POV has at least one Character thread (their lie/
  truth arc). Threads opened by one POV may be closed by another *only*
  when the convergence flag is set.
- **Promise/payoff bookkeeping:** every per-POV `storyDebtId` must list
  `expectedPayoffSlotId` either inside that POV's slots or at a
  convergence slot. No POV may have more than 30% of its story debts
  closed only at convergences (the POV's individual arc must matter).

### Character pressure rules

- **Want vs. need:** each POV gets its own want/need pair. The novel-level
  strategy packet's want/need is a synthesis or thematic statement, not a
  POV's want.
- **Agency floor:** each named POV must drive the plot (cause an event)
  at least 4 times across the book; pure-witness POVs are forbidden.
- **Relationship movement:** at least one cross-POV relationship moves
  from "unknown" → "in conflict" or "allied" by EPI-15.

### Worldbuilding pressure rules

- **New-element introduction cadence:** one major operating rule per ~10
  chapters, but cosmological-scale rules locked at EPI-11 and not later.
- **Cost-of-magic:** every magic system in use must demonstrate cost in a
  scene where a character (POV or not) pays it.
- **Prophecy / fate handling:** if a prophecy is introduced, it must be
  dramatized at one of {literal-fulfillment, subverted-fulfillment,
  failed-fulfillment} — never left ambiguous through the climax.

### Diagnostics

1. `povBalance`: each named POV gets at least 8% and at most 40% of
   chapter share. Outside that range = pack failure.
2. `convergenceLanding`: convergence slots actually involve ≥2 POVs in
   shared/causally-coupled scenes, not just same-chapter.
3. `cosmologicalConservation`: the cosmological stake stated in the
   strategy packet is referenced at EPI-11, EPI-13, EPI-17, and EPI-19.
4. `crossPovCausality`: at least 60% of POVs have ≥1 plot beat directly
   caused by another POV's earlier action.
5. `setPieceDramatization`: each EPI-08, EPI-14, EPI-17 chapter contains
   at least one scene where the set-piece's stakes are *embodied by a POV
   character's choice*, not narrated at distance.

### Anti-patterns

- "Mosaic without convergence" — POVs never causally couple.
- "Tour bus" — POV B exists to show the reader a place POV A doesn't visit.
- Prophecy as plot crutch.
- "All POVs sound the same" (voice-flat).
- Set-piece battle resolved by a magic rule introduced in the same scene.
- Cosmological stake announced in chapter 1 and then dropped until the
  climax (no progression).
- Per-POV climaxes that don't connect to the central climax.
- One POV revealed to be the protagonist all along (post-hoc demotion of
  the others).
- Unbalanced POV time — one POV gets 60%+ of chapters; the others read as
  vestigial.

### Synthetic golden examples

**Example EPI-A.** Subgenre: secondary-world political-cosmological epic.
Length: 18-slot novel-level spine for a 4-POV (Aris/Beren/Calla/Dru) book.
Completeness: novel-level slot map; per-POV shadow slots not enumerated.

| Slot | Chapter range | POVs | Convergence flag | Promise / payoff |
| --- | --- | --- | --- | --- |
| EPI-01 | 1 | Aris | no | Open: world ruleset; world-orientation. |
| EPI-02 | 2-3 | Aris | no | Open: thread A (Aris is named diplomat for a king who is dying). |
| EPI-03 | 4-5 | Beren | no | Open: thread B (Beren is a mountain border captain whose patrol disappears). |
| EPI-04 | 6-8 | Calla, Dru | no | Open: thread C (Calla is a scholar who deciphers a fragment), thread D (Dru is a smuggler caught in a cult-affiliated cargo). |
| EPI-05 | 9 | Calla, Beren | no | Setup: convergence #1 (Calla's fragment names a place; Beren's patrol disappeared near it). |
| EPI-06 | 10 | (antagonist-aligned secondary POV) | no | Open: antagonist's plan to trigger a cosmological event. |
| EPI-07 | 11-13 | Aris, Beren, Calla, Dru | no | Open: per-POV story debts. Aris is implicated in a coup plot; Beren leaves his post to investigate; Calla is summoned to court; Dru is captured. |
| EPI-08 | 14-15 | Aris, Calla | no | Setup: court intrigue set-piece pays out a treaty. |
| EPI-09 | 16-17 | Calla, Beren | yes | Repaid: convergence #1 (Calla and Beren meet at the missing patrol's site; Beren is wounded; Calla learns the cosmological stake is real). |
| EPI-10 | 18-19 | Aris, Dru | no | Antagonist wins a public confrontation; Dru is conscripted; Aris exiled. |
| EPI-11 | 20-21 | Calla, Beren | no | Repaid (subverted): coalition theory. The cosmological event is not what they thought; the antagonist is preventing it, not causing it. |
| EPI-12 | 22-25 | all four | no | Per-POV recommitment. Aris chooses to honor his oath despite exile. Beren chooses Calla's mission over his soldiers. Calla chooses to use a forbidden technique. Dru chooses to keep her word to a cult member who saved her. |
| EPI-13 | 26-27 | Calla | no | Repaid (partial): cosmological stake hits Calla — she loses someone to the magic itself. |
| EPI-14 | 28-29 | Aris, Dru | yes | Setup: gauntlet. Aris and Dru independently arrive at the antagonist's seat, recognize each other, and realize they need each other. |
| EPI-15 | 30-32 | all four | yes | Repaid: cross-POV coupling (full). All four POVs converge on the cosmological event site. |
| EPI-16 | 33-34 | all four | yes | Final approach. Each names a personal cost; Calla's technique will end her. |
| EPI-17 | 35-37 | all four | yes | Climactic confrontation. The cosmological event is allowed to happen, on revised terms, paying multiple costs. Climax distributed across four POV scenes. |
| EPI-18 | 38-39 | all four | yes/no | Per-POV consequence. Calla survives but altered. Aris is restored. Beren retires. Dru becomes the antagonist's successor. |
| EPI-19 | 40 | Aris | no | Coda. World-after. |

Promise/payoff trace: 12 named promises; 11 paid; 1 deliberately deferred to
series. POV chapter share: Aris 28%, Beren 23%, Calla 27%, Dru 22%. Convergence
chapters: 4 (EPI-09, EPI-14, EPI-15, EPI-17). No new entities introduced after
EPI-15.

**Example EPI-B.** Subgenre: epic-fantasy POV-rotation pattern. Completeness:
chapter-rotation schedule for 4 POVs across 60 chapters. Convergence
chapters cluster at the EPI-09 zone (~20%), EPI-15 zone (50-60%), and
EPI-17 zone (85-95%); the last 8 chapters are a sustained climax pyramid
where most chapters are flagged convergence.

---

## Method Pack: Thriller Fantasy v0

### Identity

- **Genre family:** Thriller fantasy. Fantasy-set thriller with a ticking
  clock, threat compounding, and antagonist forward-pressure that never
  releases. Fantasy elements are *operational* (used by the antagonist,
  constrain the protagonist, or both) — not decorative. References (form
  not prose): Daniel Abraham's *The Dagger and the Coin*'s spine when
  thriller-tight; Ben Aaronovitch's *Rivers of London*; Brent Weeks's
  *Night Angel*.
- **Reader contract:** *Pressure will not release. The protagonist's window
  to act is closing measurably, and when it closes, irreversible bad things
  happen.*
- **Disqualifying violations:**
  - The clock pauses, slows, or is forgotten for >2 consecutive chapters.
  - The magic system has no operating cost, so escapes feel free.
  - The antagonist is offstage for the whole middle.
  - "All is lost" is undermined by an ally arriving with no setup.
  - Resolution removes the clock without paying its price.

### Parameters (planner inputs)

| Parameter | Default | Notes |
| --- | --- | --- |
| Chapter count | 28-40 | Compressed vs. epic; tight vs. CFA. |
| Word count target | 90k-110k | Single-volume thriller-fantasy. |
| POV mode | Single or dual | Dual = protagonist + antagonist alternating. |
| Magic system stance | Hard, with explicit cost | "Soft magic in a thriller" is a disqualifying violation by default. |
| Romance weight | None to B-plot | A-plot romance is RMT v0 territory. |
| Mortality stance | realistic | Stakes must be credible. |
| Clock granularity | required | one of {hours, days, ritual-counter, deadline-bound}. |
| Antagonist POV | required | one of {dual-POV, glimpse-only, offstage-with-evidence}. |

### Pack-specific schema overlay

- `clockManifest` — `{type, startValue, currentValueBySlotId, endValue,
  consequenceIfElapsed}`. The clock value monotonically tightens.
- `antagonistPlanLedger[]` — list of `{stepId, description, planner-evidenced
  setup slot, planner-evidenced execution slot}`. Every antagonist step the
  reader will see executed must have an earlier setup beat the protagonist
  could (in retrospect) have used.
- `magicCostLedger[]` — for each use of magic, `{userId, costType,
  costMagnitude, paidInSlotId}`. Used to verify magic-cost gate at every
  escape.

### Chapter-function template

| Slot | Function | Required scene action | Character pressure | World pressure | Promise made/repaid | Diagnostic if missing |
| --- | --- | --- | --- | --- | --- | --- |
| THF-01 | Pre-clock baseline | Protagonist's normal, with one specific competence and one specific deficit. | Want surfaces. | World ruleset shown briefly. | Open: reader contract. | `endpointLanding`. |
| THF-02 | Inciting crime / threat | A specific irreversible bad thing has happened or is about to. | Protagonist drawn in. | World pressure point activated. | Open: clock. | `causalMomentum`. |
| THF-03 | Clock starts | The deadline is named, on-page, with units. | Pressure operationalized. | World rules state the deadline. | Open: clock; setup: consequence-if-elapsed. | **Hard slot.** Clock must be on-page, not implied. |
| THF-04 | First investigation / resistance | Protagonist starts moving; encounters first concrete obstacle. | Lie working. | World pushes back. | Setup: antagonist's plan. | `worldAsEngine`. |
| THF-05 | Hero at the antagonist's mercy (first) | Per Coyne's thriller obligation. Smaller-scale version. | Helplessness. | Antagonist's reach demonstrated. | Repaid (first): "antagonist is real." | `causalMomentum`. **Hard slot, Coyne-required.** |
| THF-06 | Magic-cost demonstration | Magic is used (by anyone) and pays a concrete price. | Lesson registered. | Magic-cost rule established. | Open: magic-cost gate. | `worldAsEngine`. **Hard slot.** |
| THF-07 | Reveal of antagonist's scope | Plan's true size becomes visible. | Stakes named. | World scale increases. | Open: revised promise. | `endpointLanding`. |
| THF-08 | Red herring or false-resolution | A solution is offered that seems to work. | Lie peaks. | World cooperates briefly. | Setup: subversion. | `causalMomentum`. |
| THF-09 | False-resolution collapse | The solution fails; consequences are paid. | Lie cracked. | Clock advances faster. | Repaid (subverted): false-resolution. | `arcStatePerBeat`. **Hard slot.** |
| THF-10 | Cost paid (ally) | An ally is hurt, lost, or compromised. | Grief + commitment. | Antagonist's reach proven. | Repaid (partial): clock cost. | `relationshipMovement`. |
| THF-11 | Hero at antagonist's mercy (second / climactic version) | Coyne's thriller signature scene at full scale. | All-is-lost. | Antagonist near-total leverage. | Open: defining choice. | **Hard slot, Coyne-required.** |
| THF-12 | All-is-lost / point of no return | Protagonist's plan has been broken; clock at near-zero. | Lie collapses. | World pressure maximized. | Repaid: lie/truth. | `arcStatePerBeat`. |
| THF-13 | Sacrifice or willingness-to-die | Protagonist names a personal cost they will pay. | Need accepted. | World accepts terms. | Setup: confrontation. | `characterMateriality`. **Hard slot, Coyne-required.** |
| THF-14 | Final approach | Plan assembled under tight constraints; cost named. | Resolve. | World rules constrain plan. | Setup: climactic confrontation. | `proseReadiness`. |
| THF-15 | Final confrontation in confined space | Coyne thriller convention: confined / symbolic location. | Defining choice executed. | World pays decisive turn. | Repaid: clock; magic-cost demoed in payoff. | **Hard slot, Coyne-required.** |
| THF-16 | Society / order restoration (or pyrrhic) | Coyne convention. Normalcy returns or an explicitly damaged version of it does. | Cost named. | World post-climax depicted. | Repaid: reader contract. | `endpointLanding`. **Hard slot, Coyne-required.** |
| THF-17 | Final image / next clock | Coda. If a series, a new clock is named. | Quiet. | World coda. | Open (series): next clock. | `proseReadiness`. |

### Scene contract

- **Dramatic completeness:** v1 contract. Plus: every scene that uses
  magic must declare a `magicCostLedger` entry; checker verifies the
  cost is paid by THF-15 at latest.
- **Value charge:** clock manifest implies the macro polarity. Most
  scenes close negative or mixed on `freedom-slavery`, `life-death`,
  `power-weakness` axis. THF-08 may close positive (false hope). THF-15
  closes positive on the same axis chosen for the story's reader contract.
- **MICE thread:** Event thread dominates. Idea/Inquiry threads
  (investigation) are common. Character threads run in parallel. No
  Milieu thread should dominate (genre rule).
- **Promise/payoff bookkeeping:** the clock is its own `storyDebtId`
  with `payoffPolicy: 'must close at THF-15'`. Every
  `antagonistPlanLedger` step is its own debt.

### Character pressure rules

- **Want vs. need:** want is "stop the clock" or "save X"; need is
  almost always "accept that the cost has to be paid by *me*, not by
  someone else."
- **Agency floor:** protagonist must drive every chapter from THF-04
  onward. Pure-receiving chapters are forbidden.
- **Relationship movement:** at least one ally is paid (lost,
  compromised, or sacrificed) by THF-10 or earlier.

### Worldbuilding pressure rules

- **New-element introduction cadence:** all magic-system rules locked
  by THF-06. Introducing a new magic rule after THF-09 = pack failure.
- **Cost-of-magic:** mandatory at THF-06; mandatory at every escape
  scene; climactic at THF-15.
- **Antagonist-as-magic-user (if applicable):** antagonist's magic must
  pay cost too. Asymmetric magic-cost = "antagonist cheats" =
  pack failure.

### Diagnostics

1. `clockMonotonicity`: clockManifest values are monotonically
   tightening across slots. No reset events without a stated cause.
2. `magicCostGate`: every magic use has a paid cost within 2 slots
   (or the cost is explicitly deferred and paid at THF-15).
3. `antagonistPresence`: antagonist appears or has on-page evidence
   of presence in at least 60% of chapters between THF-04 and THF-14.
4. `redHerringResolution`: THF-08 is dramatized as a *plausible*
   solution and THF-09 is dramatized as its collapse with consequences.
5. `coyneThrillerObligation`: all five Coyne thriller obligatory scenes
   (inciting crime, hero-at-mercy ×2, all-is-lost, sacrifice, confined
   confrontation, restoration) appear in the slot order shown.

### Anti-patterns

- Clock with no units (vague urgency).
- "Investigation chapters" with no antagonist pressure.
- Magic that pays no cost.
- All-is-lost rescued by a previously-unmentioned ally.
- Antagonist reveal that adds no constraint to the plan.
- Final confrontation in an open environment (genre-incorrect for
  thriller — Coyne's confined space is load-bearing).
- "Society restored" with no acknowledged damage.
- "It was actually X all along" reveal that retroactively recodes the
  setup without a setup-clue trail.
- Protagonist solves the case by force in a genre that promised
  cleverness (or vice versa).

### Synthetic golden examples

**Example THF-A.** Subgenre: urban-fantasy thriller. Length: 17-slot
spine, 32 chapters. POV: dual (protagonist Eda + antagonist Voss).

| Slot | Chapter | POV | Clock value | Scene function | Promise/payoff |
| --- | --- | --- | --- | --- | --- |
| THF-01 | 1 | Eda | (n/a) | Eda is a forensic ritualist with a reputation for not following procedure. | Open: reader contract |
| THF-02 | 2 | Eda | start | A ritualized murder is found; the victim was Eda's mentor. | Open: clock |
| THF-03 | 3 | Eda | T-72h | The pattern indicates a ritual that completes in 72 hours; Eda names the deadline aloud to her captain. | Open: clock established |
| THF-04 | 4-5 | Eda | T-66h | Eda investigates the mentor's notes; bureaucracy obstructs. | Setup: antagonist's plan-step #1 |
| THF-05 | 6 | Eda | T-58h | Eda confronts a low-level cultist who knocks her out and leaves a warning. | Repaid (first): "antagonist is real" |
| THF-06 | 7 | Eda | T-50h | Eda uses a tracking ritual; pays a memory cost (loses a year of childhood memories). | Open: magic-cost gate |
| THF-07 | 8-9 | Voss | T-42h | First Voss POV: he is conducting setup for the climactic ritual; the scope is national. | Open: revised promise |
| THF-08 | 10-11 | Eda | T-30h | Eda follows a lead; arrests a cultist who confesses to the entire plan. | Setup: false-resolution |
| THF-09 | 12 | Eda | T-24h | The cultist's confession was rehearsed; he was a decoy; clock advances to T-18h. | Repaid (subverted): false-resolution |
| THF-10 | 13-14 | Eda | T-15h | Eda's partner is taken hostage; Voss makes a call. | Repaid (partial): clock cost |
| THF-11 | 15 | Eda | T-10h | Eda is captured during the rescue; Voss reveals her mentor was complicit. | Repaid: hero-at-mercy (climactic) |
| THF-12 | 16-17 | Eda | T-7h | Eda escapes; her partner is dead; she has no plan. | Repaid: lie/truth (her mentor was not the safe figure she believed) |
| THF-13 | 18 | Eda | T-5h | Eda decides to use the ritual *against* Voss, paying the same cost (memories of the mentor). | Setup: confrontation; sacrifice declared |
| THF-14 | 19-20 | Eda+Voss alternating | T-3h | Eda assembles materials; Voss prepares the central altar. | Setup: climactic confrontation |
| THF-15 | 21-23 | Eda | T-1h | Eda confronts Voss in the altar chamber (confined); the ritual is partly completed; Eda inverts it, paying the memory cost; she loses everything she remembers about the mentor. | Repaid: clock; magic-cost climactic demo |
| THF-16 | 24 | Eda | T+0 | Order restored; Eda's partner is honored; Eda no longer recognizes a photo of her mentor. | Repaid: reader contract; pyrrhic |
| THF-17 | 25 | Eda | (n/a) | Eda is offered a new case; she accepts; the camera shows a sigil on the case file the reader recognizes. | Open (series): next clock |

Promise trace: 8 promises, 7 paid, 1 deferred to series. Magic cost ledger: 4
uses, 4 paid (one paid climactically). Antagonist on-page chapters: 21/32
(>60%). All five Coyne thriller obligatory scenes hit at the prescribed slots.

**Example THF-B.** Subgenre: secondary-world thriller. Completeness:
clock-manifest sample.

```
clockManifest = {
  type: 'ritual-counter',
  startValue: '7 candles lit',
  endValue:   '0 candles lit',
  consequenceIfElapsed: 'the binding fails; the bound entity is loose in the city',
  schedule: [
    {slotId: 'THF-03', value: '7 lit'},
    {slotId: 'THF-05', value: '6 lit'},
    {slotId: 'THF-07', value: '5 lit'},
    {slotId: 'THF-09', value: '4 lit'},   // false-resolution collapse advances clock
    {slotId: 'THF-11', value: '2 lit'},   // antagonist deliberately accelerates
    {slotId: 'THF-13', value: '1 lit'},
    {slotId: 'THF-15', value: '0 lit, but inverted by climactic ritual'},
  ]
}
```

This is what the planner emits as the clock manifest. Checker verifies the
schedule is monotonically decreasing and aligned to slot order.

---

## Method Pack: Cozy Mystery Fantasy v0

### Identity

- **Genre family:** Cozy mystery with fantasy elements. Low on-page
  violence, emotionally-stakeful relationships, a community-as-protagonist
  flavor, and a fair-play whodunit at the spine. References (form):
  T. Kingfisher's *Swordheart*-tone, Genevieve Cogman's *Invisible Library*
  (lower-violence end), classic Christie-shape but spell-flavored.
- **Reader contract:** *I will be invited into a community I want to
  return to; a wrong has been done; clues are placed fairly; resolution
  restores the community while changing one specific relationship.*
- **Disqualifying violations:**
  - On-page violence beyond a brief act (the genre allows the body, not
    the bludgeoning).
  - Magic solves the mystery (deus ex magic).
  - The killer/antagonist is introduced after the 75% mark.
  - The community is decorative — no specific named recurring NPCs.
  - The protagonist's emotional stake is generic (not "this victim was
    my godmother" but "this victim was a stranger").
  - The mystery resolves with a confession not derived from clues.

### Parameters (planner inputs)

| Parameter | Default | Notes |
| --- | --- | --- |
| Chapter count | 22-30 | Cozy is structurally tight. |
| Word count target | 75k-95k | KU-cozy length. |
| POV mode | Single | Multi-POV cozy is unusual; defaults to single. |
| Magic system stance | Soft (low-cost flavor magic) | Hard magic distorts toward thriller. |
| Romance weight | B-plot to co-equal | Romance is genre-typical but not required. |
| Mortality stance | pulp-safe | One body is the genre default; multi-body cozy is unusual. |
| Suspect count | required (3-6) | Each suspect is a named, distinct person with an alibi/motive. |
| Red-herring count | required (1-3) | Each red herring has a real prior cause. |

### Pack-specific schema overlay

- `clueLedger[]` — list of `{clueId, introducedSlotId, observedBy,
  apparentMeaning, actualMeaning, resolvedSlotId}`. Every clue is either
  load-bearing or deliberately-dressing (not silently dropped).
- `suspectRoster[]` — list of `{suspectId, motive, opportunity, means,
  alibi, redHerringStatus, finalRole}`.
- `communityLedger[]` — list of named NPCs, their relationships to
  protagonist, and an "appears in slot range" entry.
- `emotionalStakeAxis` — one specific named relationship that moves
  through the book (often unrelated to the mystery's solution).

### Chapter-function template

| Slot | Function | Required scene action | Character pressure | World/Community pressure | Promise made/repaid | Diagnostic if missing |
| --- | --- | --- | --- | --- | --- | --- |
| CMF-01 | Community baseline | Establish the community, the protagonist's place in it, and one specific relationship under low-grade tension. | Belonging + low friction. | Community shown, named. | Open: reader contract. | `endpointLanding`. |
| CMF-02 | Inciting wrong | A wrong has been done — body, theft, magical mishap with consequences. | Protagonist personally affected. | Community feels the wrong. | Open: mystery. | `causalMomentum`. |
| CMF-03 | Personal stake | Protagonist's connection to the wrong is named; agency reason given. | Want surfaces (find truth). | Local authority is inadequate. | Open: emotionalStakeAxis. | `characterMateriality`. |
| CMF-04 | Suspect introduction (1) | First suspect introduced via observation, gossip, or interview. | Social leverage. | Community provides info. | Setup: clue trail #1. | `worldAsEngine`. |
| CMF-05 | Clue placement (1) | First load-bearing clue is observed; protagonist may not recognize its weight. | Curiosity. | Community provides clue. | Setup: clue ledger #1. | `causalMomentum`. **Hard slot.** Clue must be observable to reader. |
| CMF-06 | Suspect introduction (2-3) | Remaining suspects introduced over 1-2 chapters. | Social complexity. | Community web shown. | Setup: clue trails #2-3. | `worldRelevance`. |
| CMF-07 | Red herring (1) | A clue that points convincingly at the wrong suspect is placed and observed. | Doubt directed. | Community misleads. | Setup: red-herring resolution. | `causalMomentum`. **Hard slot.** |
| CMF-08 | Emotional stake escalates | The named relationship in `emotionalStakeAxis` moves: a misunderstanding, a confession, a withdrawal. | Relational pressure. | Community sees the rift. | Setup: emotional payoff. | `relationshipMovement`. |
| CMF-09 | First investigation success | Protagonist learns something true that doesn't yet fit. | Curiosity rewarded. | Community fragment yields. | Setup: clue ledger #2. | `causalMomentum`. |
| CMF-10 | Misread / accusation | Protagonist (or community) accuses a wrong person on partial evidence. | Lie peaks. | Community injures the falsely-accused. | Setup: amends-needed beat. | `arcStatePerBeat`. |
| CMF-11 | Red herring collapses | The red-herring suspect is exonerated (alibi confirmed, motive disproved). | Embarrassment. | Community withdraws. | Repaid: red-herring resolution. | `causalMomentum`. |
| CMF-12 | Recommitment | Protagonist re-examines the case under revised method. | Need surfaces (humility, careful method). | Community gives second chance. | Open: revised plan. | `arcStatePerBeat`. |
| CMF-13 | Clue placement (2-3) | Mid-book clues are placed; some retroactively recolor earlier observations. | Pattern emerges. | Community yields under closer attention. | Setup: solution. | `causalMomentum`. |
| CMF-14 | Threat or escalation | A non-violent threat: a second crime, a sabotage, a missing item. | Stakes raised without violence. | Community pressure rises. | Open: deadline. | `worldAsEngine`. |
| CMF-15 | Emotional stake midpoint | The named relationship hits its lowest or highest point (depending on shape). | Vulnerability. | Community witnesses. | Repaid (partial): emotional axis. | `relationshipMovement`. **Hard slot.** |
| CMF-16 | Forced truth (about self) | Protagonist confronts their own assumption / class blindspot / prejudice. | Lie collapses. | Community reflects. | Repaid: lie/truth. | `arcStatePerBeat`. |
| CMF-17 | Solution emerges | Protagonist sees the pattern; a specific clue earlier observed is now decisive. | Quiet recognition. | Community enables solution. | Repaid (preview): mystery. | `causalMomentum`. **Hard slot — fair-play required.** |
| CMF-18 | Confrontation (low-violence) | Protagonist confronts the actual antagonist; resolution leverages a clue, not magic, not force. | Defining choice. | Community present or witnessing. | Repaid: mystery. | `endpointLanding`. **Hard slot.** |
| CMF-19 | Aftermath | Community absorbs the truth; the antagonist's cost is paid; some communal harm cannot be undone. | Mourning / recognition. | Community changed but recognizable. | Repaid: reader contract. | `endpointLanding`. |
| CMF-20 | Emotional stake landing | The named relationship arrives at its new state. | Quiet payoff. | Community accepts the new shape. | Repaid: emotional axis. | `relationshipMovement`. **Hard slot.** |
| CMF-21 | Coda / next-mystery seed | Final image of community life; if a series, a new low-grade tension named. | Belonging restored. | Community endures. | Open or close: series-promise. | `proseReadiness`. |

### Scene contract

- **Dramatic completeness:** v1 contract. Plus: every scene with a
  load-bearing clue declares a `clueLedger.clueId`. Every scene with a
  named suspect updates `suspectRoster`.
- **Value charge:** mystery scenes turn on `truth-lie`,
  `belief-doubt`, or `justice-injustice`. Emotional-stake scenes turn
  on `love-hate`, `belief-doubt`, or relationship-specific axes. The
  novel-level macro polarity is mixed; community ends restored, the
  emotional axis ends in clear movement (positive or negative).
- **MICE thread:** Inquiry thread dominates the mystery spine.
  Character thread dominates the emotional-stake spine. Milieu
  thread (the community) is open from chapter 1, never fully closes
  (it endures into the next book).
- **Promise/payoff bookkeeping:** every `clueId` opens a `storyDebtId`
  with `payoffPolicy: 'must resolve in solution chapter or earlier'`.
  Unresolved clues = pack failure.

### Character pressure rules

- **Want vs. need:** want is "find the truth"; need is almost always
  "let go of a particular self-deception about my place in this
  community."
- **Agency floor:** protagonist drives every chapter from CMF-03 onward.
- **Relationship movement:** the named `emotionalStakeAxis` relationship
  moves through at least 3 explicit state-changes by CMF-20.

### Worldbuilding pressure rules

- **New-element introduction cadence:** the magic system is established
  by CMF-04; no new magical rules appear after CMF-13 (cozy genre's
  "fair play" extends to the magic).
- **Cost-of-magic:** soft-magic flavor; if magic *can* solve the
  mystery, the genre is broken. Magic must be incidental, not load-
  bearing, in CMF-17 and CMF-18.
- **Community detail cadence:** at least one named NPC appears (or is
  referenced) in every chapter from CMF-01 to CMF-21.

### Diagnostics

1. `cluesLanded`: every `clueLedger` entry is observed by the reader
   before the solution slot.
2. `suspectFairPlay`: the actual antagonist appears (or is on-page
   referenced) before the 60% mark.
3. `redHerringHonest`: the red herring has its own *real* explanation
   (not a planted false clue with no real cause).
4. `magicNotSolution`: solution chapter does not depend on a magic-rule
   payoff; magic may flavor the confrontation but cannot supply the
   logical key.
5. `emotionalAxisMovement`: the `emotionalStakeAxis` relationship moves
   in at least 3 named state-changes; it ends in a state different from
   chapter 1.
6. `communityRestoration`: the community at CMF-19/20 is recognizably
   the same community as CMF-01, but with at least one named change.

### Anti-patterns

- Clue dump in solution chapter (Christie's "Hercule Poirot reveals
  it all" but unmotivated).
- Magic solves the mystery.
- The antagonist is a stranger introduced at 75%.
- "Cozy" stops being cozy — graphic violence, cruelty, or torture.
- Community is a list of names, not a web of relationships.
- Romance subplot eats the mystery (then it's RMT v0).
- Protagonist's emotional stake is generic ("I love justice") rather
  than specific ("the victim was my godmother").
- Confession not derived from clues.

### Synthetic golden examples

**Example CMF-A.** Subgenre: village-witch cozy. Length: 21-slot spine,
24 chapters. POV: single (protagonist Wynn, a hedge-witch).

Suspect roster (4 named):

- Suspect 1: village headman (motive: land dispute; status: red
  herring; final role: exonerated, becomes ally).
- Suspect 2: visiting scholar (motive: rivalry; status: misled; final
  role: provides decisive observation in CMF-17).
- Suspect 3: the apothecary's apprentice (motive: jealousy; status:
  truly guilty; final role: antagonist).
- Suspect 4: Wynn's estranged sister (motive: inheritance; status:
  red herring layered on emotional stake; final role: relationship
  resolves at CMF-20).

`emotionalStakeAxis`: Wynn ↔ estranged sister.

Clue ledger (8 clues):

- C1 (CMF-05): a missing herb from Wynn's garden.
- C2 (CMF-06): the victim's last appointment was with the apothecary.
- C3 (CMF-07): a footprint near the body matches the headman's boot
  (red herring — he visited earlier that day, innocent reason).
- C4 (CMF-09): the missing herb induces a specific dream.
- C5 (CMF-13): the apprentice's training records show interest in
  exactly that herb's effect.
- C6 (CMF-13): the scholar saw the apprentice purchase a herb-binding
  book.
- C7 (CMF-15): Wynn's sister has been visiting the headman (red
  herring on emotional axis — they are caring for an aged
  relative the sister did not tell Wynn about).
- C8 (CMF-17): the dream the herb induces matches the victim's last
  reported nightmare — the apprentice planted the herb to drive the
  victim insane before killing them, hiding the murder as suicide.

Slot map abbreviated:

| Slot | Chapter | Scene function | Clue/Suspect activity |
| --- | --- | --- | --- |
| CMF-01 | 1 | Wynn at the Solstice market; brief tension with sister. | Community established. |
| CMF-02 | 2 | Body found near the river; victim was Wynn's godmother (the village's prior witch). | Mystery opens. |
| CMF-03 | 3 | Wynn explains to the bailiff why she will look into this. | Stake named: emotional axis with godmother's memory. |
| CMF-04 | 4 | Wynn interviews the headman. | Suspect 1 introduced. |
| CMF-05 | 5 | Wynn notices a missing herb from her garden. | C1 placed. |
| CMF-06 | 6-7 | Wynn meets the scholar and visits the apothecary. | Suspects 2 and 3 introduced. C2 placed. |
| CMF-07 | 8 | Footprint discovery near the body. | C3 placed (red herring on Suspect 1). |
| CMF-08 | 9 | Wynn's sister refuses to discuss her recent absences. | Emotional axis escalates. |
| CMF-09 | 10 | Wynn realizes the missing herb is the dream-inducer. | C4 placed. |
| CMF-10 | 11 | Wynn (and the village) accuses the headman publicly. | Misread; injury to community. |
| CMF-11 | 12 | Headman's alibi is verified by the scholar. | Red herring collapses. |
| CMF-12 | 13 | Wynn apologizes; revises method. | Recommitment. |
| CMF-13 | 14-15 | Wynn checks training records; scholar volunteers an observation. | C5, C6 placed. |
| CMF-14 | 16 | Apprentice attempts to dose Wynn herself with the same herb (escalation, non-violent). | Threat. |
| CMF-15 | 17 | Wynn's sister, after being seen at the headman's, is accused by the village; she stays silent. | Emotional axis midpoint. |
| CMF-16 | 18 | Wynn realizes she has been treating her sister with the same suspicion she gave the headman; she confronts her own pattern. | Forced truth. |
| CMF-17 | 19 | Wynn sees the dream connection; clue C8 forms in her mind. | Solution emerges. |
| CMF-18 | 20 | Wynn confronts the apprentice; the confrontation hinges on C4+C5+C8 (logical proof, not magic). | Mystery resolved. |
| CMF-19 | 21 | Apothecary's apprentice is removed; community grieves the godmother properly. | Aftermath. |
| CMF-20 | 22 | Wynn and her sister meet at the godmother's grave; sister explains C7's truth (caring for aged relative). | Emotional axis lands. |
| CMF-21 | 23-24 | Wynn opens her garden to a new apprentice; final image is the sister at the gate. | Coda; series-promise (the new apprentice is unspecified). |

Promise trace: 8 clues, all resolved. 4 suspects, all dispositions named.
Emotional axis moves through 4 state changes (estranged → suspicious →
falsely-accused → restored). No new entities introduced after CMF-15.

**Example CMF-B.** Subgenre: cozy fantasy mystery. Completeness:
chapter-level scene plan for CMF-17 (the solution-emerges chapter).

Chapter (CMF-17 slot, "Solution emerges"):

- Scene 1 (`goal`: Wynn re-reads her own herb-garden journal;
  `opposition`: the journal's entries don't quite line up;
  `turningPoint`: she realizes the missing herb's dream effect matches
  the victim's reported nightmares; `crisisChoice`: confront the
  apprentice now or build the proof first; `climaxAction`: build
  proof; `resolution`: she begins listing the chain of clues.
  `valueIn`: doubt; `valueOut`: belief. `consequence`: she has the
  full chain except a missing link about means.)
- Scene 2 (`goal`: visit the apothecary's records on a pretext;
  `opposition`: the apprentice is present and watchful;
  `turningPoint`: Wynn finds a margin note in the apprentice's hand
  on a page about the dream-herb's preparation; `crisisChoice`: take
  the page or leave it; `climaxAction`: copies the note onto her own
  notebook in front of the apprentice (signaling confrontation is
  coming); `resolution`: leaves quietly.
  `valueIn`: secrecy; `valueOut`: declaration. `consequence`:
  apprentice now knows Wynn knows.)
- Scene 3 (`goal`: notify the bailiff and request a witness for the
  confrontation; `opposition`: the bailiff is hesitant after the
  earlier misread; `turningPoint`: Wynn shows the chain in
  three lines and the bailiff agrees; `crisisChoice`: confront
  alone or with witness; `climaxAction`: with witness; `resolution`:
  they head to the apothecary.
  `valueIn`: isolation; `valueOut`: communal authority restored.
  `consequence`: CMF-18 begins under proper procedure, paying
  off CMF-10's accountability lesson.)

---

## Method Pack: Progression / LitRPG v0

This pack extends `docs/research/writing-frameworks/litrpg-progression.md`
into a method-pack form. It deliberately stays "diagnostic-only" per
CLAUDE.md's standing strategic constraint that LitRPG is no longer the
assumed proving ground.

### Identity

- **Genre family:** Progression fantasy and LitRPG. Sub-flavors: classic
  LitRPG (with diegetic system), Western progression (no system, named
  tiers), Eastern cultivation. References: *Cradle*, *DCC*, *HWFWM*,
  *Defiance of the Fall*, *MoL*, *Beware of Chicken*, *ISSTH*. Genre
  contract is uniquely literal — readers explicitly track promises.
- **Reader contract:** *I will see measurable, named, monotonic
  power-progression on a curve I can predict and the protagonist must
  earn.*
- **Disqualifying violations:**
  - The protagonist is at the target tier within 25% of the book.
  - Power-creep budget overrun (more than one major tier advance per
    book).
  - Stat/tier non-monotonic without a stated cost event.
  - System-voice drift across chapters.
  - Promises declared by protagonist that do not progress on-screen
    every ~3-5 chapters.
  - Magic/system rules introduced post-75% to solve the climax.

### Parameters (planner inputs)

| Parameter | Default | Notes |
| --- | --- | --- |
| Chapter count | 35-80 | Royal Road / KU shape. |
| Word count target | 100k-200k | Per-book; series volumes can run higher. |
| POV mode | Single, occasional planned swap | Multi-POV is genre-tolerated but breaks per-chapter system tracking. |
| Magic system stance | Hard, with explicit cost/budget | The system *is* the magic system. |
| Romance weight | None to B-plot | A-plot romance distorts the progression spine. |
| Mortality stance | varies; declared per-flavor | Cultivation tolerates higher mortality. |
| Subgenre | required | one of {classic-litrpg, system-apocalypse, isekai-system, native-system, dungeon-core, western-progression, eastern-cultivation}. |
| `progressionLadder` | required | named tiers with `{differentiator, gate, risk}`. |
| `originDeficit` | required | one-line public weakness. |
| `protagonistAmbition` | required | named tier or named goal the protagonist swears to reach. |
| `systemVoice` | required iff system is diegetic | `{tone, register, exemplars}`. |

### Pack-specific schema overlay

Adds these to v1 packet:

- `progressionLadder[]` — list of `{tierId, differentiator, gate, risk}`.
- `creepBudget` — `{tierAdvances: int, newSkills: int, newArtifacts: int,
  newRelationships: int}`.
- `levelUpCadence` — phase-banded `{earlyChaptersPer, midChaptersPer,
  lateChaptersPer}`.
- `systemVoice` — `{tone: enum, register: enum, exemplars: [3-5 lines]}`.
- `promiseRegistry[]` — list of `{promiseId, declaration_chapter,
  expected_payoff_window, quality_gate}`. (Note: `quality_gate` is
  e.g. "must be used decisively in a fight" for skill promises.)

### Chapter-function template

| Slot | Function | Required scene action | Character pressure | World/System pressure | Promise made/repaid | Diagnostic if missing |
| --- | --- | --- | --- | --- | --- | --- |
| LRP-01 | Pre-system baseline | Protagonist's `originDeficit` is dramatized in a single specific scene. | Want: stop being this. | Pre-system world. | Open: progression promise. | `endpointLanding`. **Hard slot.** |
| LRP-02 | System / threshold event | Inciting event: system arrives, protagonist crosses portal, sect entrance, or first cultivation. | Disorientation. | Operating ruleset begins. | Open: system literacy. | `worldAsEngine`. |
| LRP-03 | First system-message / first stat reveal | Stat block emitted; protagonist reacts in-character (1-2 sentence reaction beside the block). | Curiosity, dread, or excitement. | System voice established. | Setup: `systemVoice`. | **Hard slot, LitRPG-flavor.** |
| LRP-04 | Class / path / sect selection | Commitment to a build identity. | Commitment under uncertainty. | World provides options. | Open: build promise. | `arcStatePerBeat`. **Hard slot.** |
| LRP-05 | Tier hierarchy reveal | The reader and the protagonist learn the named tier ladder. | Mountain shown. | World tier ladder visible. | Open: full progression promise. | `worldRelevance`. **Hard slot, progression.** |
| LRP-06 | First competence test | Protagonist applies the starting ability and survives by the skin of their teeth. | Stakes of the lowest tier. | World rules bite. | Repaid (first): system literacy. | `causalMomentum`. |
| LRP-07 | First defeat | Protagonist is decisively outmatched by something at a higher tier. | Humility installed. | Tier strictness demonstrated. | Setup: ambition. | `worldAsEngine`. |
| LRP-08 | Mentor / guild / sect contract | Protagonist binds to a structure that will provide gates and resources. | Social leverage. | World provides structure. | Open: mentor debt. | `relationshipMovement`. |
| LRP-09 | Skill unlock #1 | First named skill gained; cost paid (training, resource, time). | Build identity. | System pays out. | Repaid (first): build promise. | `causalMomentum`. |
| LRP-10 | Bottleneck / friction | Protagonist hits a wall — can't advance further without a missing insight or resource. | Frustration. | World blocks. | Setup: insight. | `arcStatePerBeat`. |
| LRP-11 | Insight beat | Triggered by an outside event, the protagonist sees their toolkit differently. | Recognition. | World gives the angle. | Setup: minor advancement. | `causalMomentum`. |
| LRP-12 | Minor advancement | Skill levels, technique refines, build optimizes. Stat block emitted. | Earned victory. | System pays. | Repaid: insight. | `worldAsEngine`. |
| LRP-13 | Trope-deployment beat (optional) | Genre-trope intentionally invoked (face-slap, treasure pickup, training arc, etc.) with full setup-cost-payoff. | Genre delight. | World stages the trope. | Open or Repaid (depending on trope phase). | `proseReadiness`. |
| LRP-14 | Mid-book antagonist clarification | A named antagonist — usually one tier above — is identified. | Stakes named. | World threat localized. | Open: confrontation. | `endpointLanding`. |
| LRP-15 | Recommitment / build pivot | Protagonist makes a build choice that closes other options. | Need accepted (specialization is real). | World accepts the lock-in. | Open: defining choice. | `arcStatePerBeat`. |
| LRP-16 | Bottleneck #2 / pre-tier wall | The wall before the tier-break. Long, hard, possibly ~10 chapters. | Stagnation. | World blocks. | Setup: tier breakthrough. | `causalMomentum`. **Hard slot, progression.** |
| LRP-17 | Tier-breakthrough preparation | Resources gathered; cost named; risk named. | Resolve. | World stages the tribulation. | Setup: breakthrough. | `worldAsEngine`. |
| LRP-18 | Tier breakthrough | The single major tier advance for this book; fully dramatized. | Cost paid. | World pays decisive turn. | Repaid: progression promise (this book). | **Hard slot, progression.** |
| LRP-19 | Climactic confrontation | Antagonist identified at LRP-14 is fought, with the new tier as the differentiator. | Defining choice executed. | System and tier rules pay. | Repaid: confrontation. | `endpointLanding`. **Hard slot.** |
| LRP-20 | Persistent-world consequence | The system world is permanently changed by the climax. | Cost named. | World changed. | Repaid: stakes. | `worldAsEngine`. |
| LRP-21 | Final image / next-tier hook | A new tier above is teased; a promise the new tier *can't* yet solve is named. | Quiet ambition restated. | World coda. | Open: next book. | `proseReadiness`. |

### Scene contract

- **Dramatic completeness:** v1 contract. Plus: any scene with a stat
  block declares `systemMessageCount`, `systemMessageCoverage` (% of
  scene words), and `systemVoiceCheck: true|false` (extractor verifies
  voice consistency).
- **Value charge:** macro polarity is positive overall (numbers go up).
  Per-scene polarity flips on `success-failure`, `power-weakness`. Zero
  scenes that close negative on `power-weakness` for a stretch >5
  chapters = pack failure ("flat-progression" trap).
- **MICE thread:** Event thread is dominant during action; Idea/Inquiry
  during system-mastery beats; Character thread runs throughout.
- **Promise/payoff bookkeeping:** every promise in `promiseRegistry`
  must show progress every ~3-5 chapters or be flagged. Skill promises
  are paid only when the skill is *used decisively* in a fight (or
  equivalent stakes), not at unlock.

### Character pressure rules

- **Want vs. need:** want is "reach the named tier" / "achieve the named
  ambition"; need is almost always "let go of the lie that arrival is
  the point" or "accept the cost of who I become at the next tier."
- **Agency floor:** protagonist drives every chapter. Genre is broken
  if a chapter passes with no protagonist-caused event.
- **Relationship movement:** at least one named ally relationship moves
  through one full state-change. Mentor-bond, sect-rivalry, and
  romantic-interest all qualify; they do not require multiple state
  changes.

### Worldbuilding pressure rules

- **New-element introduction cadence:** all major system rules
  introduced by LRP-12; new sub-systems may be added but only by
  expansion of existing axes (Sanderson's Third Law). New magic axes
  introduced after LRP-15 = pack failure.
- **Cost-of-magic:** every system use has a recorded cost.
  `magicCostLedger` (from THF v0) borrowed and required.
- **System-voice consistency:** the `systemVoice.exemplars` are
  embedded in the writer's primer; checker clusters all system-block
  text and flags outliers (not done in this pack but required for
  promotion).

### Diagnostics

1. `progressionMonotonicity`: protagonist's headline tier and key
   stats are monotonic non-decreasing or carry an explicit cost-event.
2. `creepBudgetEnforcement`: per-book counts within budget.
3. `levelUpCadenceSchedule`: cadence respected per phase-band.
4. `promiseProgressCadence`: every active promise has an on-page
   progress event every ≤5 chapters.
5. `systemVoiceConsistency`: system-block voice clusters tightly to
   the exemplars (k=3 clusters, exemplars must dominate cluster 1).
6. `tropeContractIntegrity`: any deployed trope (face-slap, treasure
   pickup, etc.) has setup ≥3 chapters earlier and cost ≤2 chapters
   after.

### Anti-patterns

- "Number-dump prose" — a chapter that is 50% stat blocks.
- Tier skips without leverage.
- Mentor dies after 2 scenes ("mentor is named in one scene and dies
  in the next").
- Build-identity reset mid-book.
- "Suddenly the protagonist has a new affinity" — unestablished.
- System-voice drift mid-book (system suddenly chatty when previously
  formal).
- Combat that pauses every 2 paragraphs for a stat block.
- Power-up via random injury, no tribulation framing.
- Harem/romance inflation without per-character distinct
  characterization.
- "Numbers go up forever" — protagonist never paid a real cost; reader
  drift.

### Synthetic golden examples

**Example LRP-A.** Subgenre: classic-LitRPG, system-apocalypse. Length:
21-slot spine, 50 chapters. POV: single (Maro).

`originDeficit`: Maro is a 38-year-old retail-pharmacy assistant manager
with a chronic back injury.

`protagonistAmbition`: reach Class Tier III ("Specialist") in this
book; reach Tier V ("Master") by series end.

`progressionLadder`: Initiate → Apprentice → Specialist → Adept →
Master → Grandmaster (6 tiers; first 5 in this series).

`creepBudget`: 1 tier advance, 4 new skills, 2 new artifacts, 2 new
relationships of plot-significance.

`systemVoice`: dry-bureaucratic. Exemplars: "[Class registration:
Apothecary (Combat-adjacent). Class XP: 0/1000. Conditions: see
Apothecary Codex.]"; "[Skill acquired: Compounding (Tier I, Lvl 1).
Cost: 1 mana / dose. Cooldown: 12s.]"; "[Quest available: Stabilize the
clinic district. Reward: scaled XP, 2 supply caches.]"

Slot map (representative):

| Slot | Chapters | Scene function | Promise/payoff |
| --- | --- | --- | --- |
| LRP-01 | 1 | Maro at the pharmacy at 7am; back is hurting; he is filling prescriptions for an ungrateful customer; wife calls about a leaky roof. | Open: progression promise (origin deficit dramatized) |
| LRP-02 | 2 | The system arrives mid-shift; the world reshapes; Maro is alive because the pharmacy's stockroom is reinforced. | Open: system literacy |
| LRP-03 | 3 | Maro's first stat screen; he is "Initiate, Class: Unselected"; one paragraph of in-character reaction. | Setup: systemVoice |
| LRP-04 | 4 | Maro selects "Apothecary" from three offered classes — the one most aligned with what he already knows. | Open: build promise |
| LRP-05 | 5 | A senior survivor gives Maro the named tier ladder over a defended cup of tea. | Open: full progression promise |
| LRP-06 | 6 | Maro brews and applies a basic stamina potion; barely survives a scavenger fight. | Repaid (first): system literacy |
| LRP-07 | 7 | A Tier II Specialist crushes a much stronger survivor in front of Maro. Lesson: tiers matter. | Setup: ambition |
| LRP-08 | 8 | Maro is recruited by a clinic-district survivor faction in exchange for daily compounding. | Open: faction debt |
| LRP-09 | 9-10 | Maro gains "Compounding II" and "Field Triage I"; uses both decisively in a scavenger raid. | Repaid (first): build promise. Skill promises paid via decisive use. |
| LRP-10 | 11-13 | Maro hits a bottleneck — Tier I → Tier II requires "Codex of Compounding" (unobtainable in city). | Setup: insight |
| LRP-11 | 14 | Maro realizes the senior survivor's tea-leaves preparation is a fragmentary Codex; he can recover the rest by inference. | Setup: minor advancement |
| LRP-12 | 15-16 | Maro reverse-engineers a Codex from the senior's traditions; gains Apprentice rank. | Repaid: insight; Apprentice tier achieved (mid-book) |
| LRP-13 | 17-18 | Trope deployment: Maro encounters a rival faction's "young cultivator" Specialist who insults him publicly. Setup for face-slap. | Open: trope-deployment debt |
| LRP-14 | 19-20 | Antagonist clarified: a Specialist-tier raider is consolidating clinics into a monopoly. | Open: confrontation |
| LRP-15 | 21-23 | Maro chooses a build pivot (combat-leaning Apothecary) that closes off pure-craft. | Open: defining choice |
| LRP-16 | 24-32 | Long stretch: Maro hits Apprentice → Specialist wall. Multiple sub-attempts fail; he is forced to accept that he needs a specific resource (the antagonist's faction has it). | Setup: tier breakthrough; tension sustained |
| LRP-17 | 33-37 | Maro plans the resource-acquisition; cost named (a faction relationship). | Setup: breakthrough |
| LRP-13b | 38-40 | Trope deployment payoff: Maro defeats the rival in a fair contest using his now-Specialist toolkit. Face-slap delivered. | Repaid: trope-deployment debt |
| LRP-18 | 41-43 | Maro breaks through to Specialist tier in a tribulation event — the system runs a "Class Trial" with measurable risk; Maro pays a cost (he loses an arm, regenerates partially). | Repaid: progression promise (this book) |
| LRP-19 | 44-46 | Climactic confrontation with the raider; Maro's new Specialist toolkit pays decisively. | Repaid: confrontation |
| LRP-20 | 47-48 | The clinic district is reorganized as a system-recognized faction (persistent-world consequence). | Repaid: stakes |
| LRP-21 | 49-50 | A Tier III "Adept" enters the city; the senior survivor warns Maro this is a different problem. | Open: next book |

Power-creep budget: 1 tier advance (Apprentice → Specialist), 4 skills
(Compounding II, Field Triage I, Stabilize III, Combat-Compound I), 2
artifacts (Codex, Stabilizer-tincture recipe), 2 relationships (senior
survivor, faction leader). Within budget. Promise registry: 6 promises,
all paid except the next-book hook. Level-up cadence: 4 in chapters
1-15 (early), 5 in chapters 16-32 (mid), 3 in chapters 33-50 (late) —
within phase-banded cadence.

**Example LRP-B.** Subgenre: Western progression cultivation. Completeness:
chapter beat plan for LRP-18 (Tier breakthrough chapter).

Chapter (LRP-18 slot, "Tier breakthrough"). Protagonist Lin Tao, 19,
breaking through Mortal-realm to Foundation-realm.

- Scene 1 (`goal`: Lin Tao enters the breakthrough chamber alone;
  `opposition`: his unstable Mortal-realm core has been bottlenecked
  for ~10 chapters; `turningPoint`: his master leaves him a single
  pill and a single cryptic line; `crisisChoice`: take the pill
  immediately or hold it for the worst moment; `climaxAction`:
  begins the breakthrough without the pill; `resolution`: his core
  resists; he holds the pill in reserve.
  `valueIn`: doubt; `valueOut`: resolve. `consequence`: the
  tribulation begins.)
- Scene 2 (`goal`: survive the heavenly tribulation (5 lightning
  strikes); `opposition`: each strike escalates and tests a
  different aspect of Lin Tao's cultivation; `turningPoint`: at
  strike 4, the master's cryptic line resolves — the pill must be
  taken at the *third* strike, not the worst one (the third tests
  the core's foundation-stability); `crisisChoice`: take the pill
  retroactively (impossible) or restructure mid-tribulation;
  `climaxAction`: restructures the core mid-strike at his lowest
  ebb, paying the cost of one of his early techniques (lost
  permanently); `resolution`: the fifth strike passes.
  `valueIn`: power-weakness on weakness side; `valueOut`: power
  achieved at named cost. `consequence`: Foundation-realm achieved;
  one technique lost; new techniques accessible.)
- Scene 3 (`goal`: stabilize and emerge; `opposition`: a hostile
  cultivator was waiting for him to be vulnerable post-tribulation;
  `turningPoint`: Lin Tao's new tier means the hostile is no longer
  decisively above him, but still equal; `crisisChoice`: fight or
  retreat; `climaxAction`: retreat (a humility beat — he is not yet
  superior, but he is no longer prey); `resolution`: returns to his
  master, reports honestly that he lost the technique and gained
  the tier.
  `valueIn`: imbalance; `valueOut`: balance achieved at cost.
  `consequence`: progression promise paid for this book; setup for
  next book's confrontation with the hostile.)

---

## Method Pack: Romantasy v0

### Identity

- **Genre family:** Romantasy. Adventure / fantasy spine interleaved with
  a co-equal or A-plot romance. References (form): Sarah J. Maas's
  *ACOTAR*, Rebecca Yarros's *Fourth Wing*, Tamora Pierce when
  romance-leaning.
- **Reader contract:** *I will see two characters' attraction grow under
  pressure that is real, both for the relationship and for the world
  they live in; consummation will arrive earned, and the relationship
  will be tested by — and not solved by — a final external pressure.*
- **Disqualifying violations:**
  - Romance is decorative: no scene where the relationship is the load-
    bearing axis of the chapter.
  - External plot solves the romance (or vice versa) without the lovers
    making a meaningful choice.
  - One love interest has no want/need pair (decorative partner).
  - Consummation precedes shared vulnerability (genre's "earned"
    standard).
  - The dark-moment-separation has no setup; lovers part for a contrived
    reason.

### Parameters (planner inputs)

| Parameter | Default | Notes |
| --- | --- | --- |
| Chapter count | 28-40 | KU-romantasy range. |
| Word count target | 110k-150k | Often longer than CFA. |
| POV mode | Single, dual-POV optional | Dual-POV is genre-typical (his/her chapters). |
| Magic system stance | Soft to hard | Softer is acceptable; hard sharpens stakes. |
| Romance weight | Co-equal (default) or A-plot | A-plot pushes external spine to B-plot. |
| Mortality stance | varies | Can range pulp-safe to grimdark. |
| Trope | required | declared trope from {enemies-to-lovers, fated-mates, marriage-of-convenience, slow-burn, second-chance, forbidden-love}. |
| Heat level | required | one of {closed-door, open-door, explicit}. |

### Pack-specific schema overlay

- `loveInterestPacket` — strategy packet for the love interest as a
  full character (not an accessory): want, need, lie, truth, loveLie
  (specific to relationship), loveTruth, presentingMask.
- `romanceArcLadder[]` — list of `{stageId, name, emotionalState,
  physicalState, expectedSlotId}`. Stages are ordered:
  noticing → testing → orbiting → pulling-close → first-vulnerability
  → public-allyship → shared-shadow → consummation → dark-moment →
  reunion → bonded-stand. (Adjust per trope.)
- `tropeSpec` — `{name, requiredBeats[], commonFailureModes[]}`.

### Chapter-function template

| Slot | Function | Required scene action | Character pressure | World pressure | Romance stage | Promise made/repaid | Diagnostic if missing |
| --- | --- | --- | --- | --- | --- | --- | --- |
| RMT-01 | Pre-romance baseline | Protagonist's life shown without the love interest; one specific competence and one deficit. | Want surfaces. | World ruleset shown. | None | Open: external promise. | `endpointLanding`. |
| RMT-02 | Meet | The two meet; both are pre-occupied with their own external goals. | Friction or attraction (per trope). | World provides setting. | noticing | Open: relationship promise. | `relationshipMovement`. **Hard slot.** |
| RMT-03 | Trope-anchor scene | The trope's defining beat fires (enemies-clash, fated-recognition, contracted-meeting, etc.). | Trope-specific. | World forces them together. | testing | Open: trope contract. | `endpointLanding`. **Hard slot.** |
| RMT-04 | First mutual mission | External plot puts them on the same goal. | Cooperation under tension. | World provides external problem. | orbiting | Setup: shared-stake. | `causalMomentum`. |
| RMT-05 | First disclosure | One reveals a wound or competence that surprises the other. | Vulnerability under control. | Setting allows intimacy. | pulling-close | Setup: trust. | `relationshipMovement`. **Hard slot.** |
| RMT-06 | External plot escalates | The external pressure tightens; the pair are committed but with separate stakes. | External pressure per character. | World pressure point #2. | orbiting | Setup: external stakes. | `worldAsEngine`. |
| RMT-07 | First kiss / first-vulnerability | The first physically- or emotionally-charged intimacy beat. | Real stakes. | World briefly recedes. | first-vulnerability | Repaid (first): trust. | **Hard slot.** Heat-level dependent. |
| RMT-08 | Public allyship | They commit to each other publicly within their world (declare, defend, choose-each-other). | Cost named. | World pushes back. | public-allyship | Open: public-cost. | `relationshipMovement`. |
| RMT-09 | Shared shadow | A wound or conflict from one's past visits both. | One must hold the other. | World stages the past. | shared-shadow | Setup: dark-moment. | `arcStatePerBeat`. **Hard slot.** |
| RMT-10 | Mid-book external reversal | External plot's working theory breaks. | Both face new stakes. | World scale shifts. | (continues) | Open: revised external promise. | `causalMomentum`. |
| RMT-11 | Consummation (per heat level) | The relationship's culmination beat; appropriate to declared heat level. | Vulnerability completed. | World briefly recedes. | consummation | Repaid: relationship arc (interim). | **Hard slot.** Sequencing rule: must follow RMT-09. |
| RMT-12 | Dark-moment separation | A specific, motivated reason the lovers part — not contrived. | Lie peaks (love-related). | World drives them apart. | dark-moment | Setup: reunion. | `arcStatePerBeat`. **Hard slot.** |
| RMT-13 | External all-is-lost | External plot reaches its lowest point; lovers are not together. | External lie peaks. | World maximizes pressure. | (separated) | Setup: defining choice. | `endpointLanding`. |
| RMT-14 | Internal forced truth | Each lover, separately, names what they were lying about (re: the other and themselves). | Both lies collapse. | World allows reflection. | (turning) | Repaid: internal lies. | `arcStatePerBeat`. **Hard slot.** |
| RMT-15 | Reunion | They reunite, on revised terms. | Need accepted on both sides. | World accepts the new pair. | reunion | Open: bonded-stand. | `relationshipMovement`. **Hard slot.** |
| RMT-16 | Bonded stand | The lovers face the external climax together; their bond is the lever. | Defining choice executed. | World pays decisive turn. | bonded-stand | Repaid: external promise; Repaid: reader contract. | `endpointLanding`. **Hard slot.** |
| RMT-17 | Aftermath | Cost named for both relationship and external. | Quiet. | World post-climax. | (settling) | Repaid: residual. | `proseReadiness`. |
| RMT-18 | Final image / next promise | A coda image of their new shape; if a series, a new ask is named. | Quiet. | World coda. | (steady) | Open or Repaid: series-promise. | `proseReadiness`. |

### Scene contract

- **Dramatic completeness:** v1 contract. Plus: every scene with both
  lovers present declares a `relationshipValueIn`, `relationshipValueOut`
  on a romance-specific axis (`distance-closeness`, `trust-doubt`,
  `power-equality`, `safety-risk`).
- **Value charge:** romance scenes turn on the relationship axis; external
  scenes turn on the v1 lifeValue axis. The novel must show movement on
  both spines in roughly 50/50 chapter share.
- **MICE thread:** Character thread for romance; Event/Idea/Inquiry/Milieu
  for external. These are *parallel* threads, not nested.
- **Promise/payoff bookkeeping:** romance arc has its own `storyDebtId`s;
  trope contract has its own debts (each `tropeSpec.requiredBeats[]` is a
  debt).

### Character pressure rules

- **Want vs. need:** both lovers have full want/need pairs. Decorative
  partner = pack failure.
- **Agency floor:** each lover drives at least one external-plot chapter
  on their own (separate-from-the-other competence shown).
- **Relationship movement:** must move through the declared
  `romanceArcLadder` stages in order; skipping stages is genre-
  unacceptable.

### Worldbuilding pressure rules

- **New-element introduction cadence:** matches CFA (1 per ~3 chapters
  early; locked by RMT-13).
- **Cost-of-magic:** soft-magic is acceptable; if hard, costs apply
  per CFA / THF.
- **External plot integrity:** the romance must not solve the external
  plot through "the power of love." The external plot must be solvable
  on its own causal terms; the relationship is a lever, not the answer.

### Diagnostics

1. `dualSpineBalance`: roughly equal share of romance and external
   chapters; neither spine dominates by >70%.
2. `tropeContractIntegrity`: declared `tropeSpec.requiredBeats` all
   appear at expected slot zones.
3. `consummationSequencing`: RMT-11 follows (chronologically) RMT-09
   and is preceded by emotional vulnerability, not just physical
   proximity.
4. `darkMomentMotivation`: RMT-12 has a specific, named, in-world
   reason that connects to a wound established in RMT-05 or RMT-09.
5. `bondedStandLeverage`: RMT-16's resolution uses a specific shared
   competence or commitment formed earlier in the romance.

### Anti-patterns

- "Love interest is a sexy cardboard."
- Romance carries the external plot's resolution.
- Consummation in chapter 4 with no buildup.
- Dark-moment break-up over a "misheard" line of dialogue.
- A second love interest who has no real wound.
- Heat level inconsistent (closed-door book opens with explicit scene).
- Trope declared but its required beats absent.
- Romance ends in a state the external plot doesn't recognize ("we
  saved the world but never spoke about us").

### Synthetic golden examples

**Example RMT-A.** Subgenre: enemies-to-lovers fantasy. Length: 18-slot
spine, 32 chapters. POV: dual.

`tropeSpec.name`: enemies-to-lovers.
`tropeSpec.requiredBeats`: explicit-antagonism (RMT-02/03), forced-
proximity (RMT-04), grudging-respect (RMT-05/06), shared-stake
(RMT-08), undeniable-attraction (RMT-07/11), enemy-context-resurfacing
(RMT-12), choosing-the-other-over-old-loyalty (RMT-15).

Slot map abbreviated:

| Slot | Chapter | POV | Scene function | Romance stage |
| --- | --- | --- | --- | --- |
| RMT-01 | 1 | Vela | Vela leads a company of outriders; her brother died at the hands of the empire. | (none) |
| RMT-02 | 2 | Both | Vela captures Lord Caen, the empire's commander, after a skirmish. | noticing |
| RMT-03 | 3 | Vela | Trope anchor: Vela can't summarily execute Caen due to a chain-of-command issue; they are bound on the road. | testing |
| RMT-04 | 4-6 | Both | Both must work together against bandits during transit. | orbiting |
| RMT-05 | 7-8 | Caen | Vela learns Caen lost his sister to the same battle that killed her brother; first disclosure both ways. | pulling-close |
| RMT-06 | 9-11 | Both | Empire pursues Caen; rebels suspect Vela; both factions threaten the pair. | orbiting |
| RMT-07 | 12 | Vela | First kiss; both retreat into duty afterward. | first-vulnerability |
| RMT-08 | 13-14 | Both | They commit to a third option — a neutral border lord who can broker peace. | public-allyship |
| RMT-09 | 15-16 | Caen | Caen's old loyalties resurface when his subordinate captures Vela's outriders. | shared-shadow |
| RMT-10 | 17-18 | Vela | The peace plan was a trap by the border lord. | (continues) |
| RMT-11 | 19 | Both | Consummation; declared after they choose to refuse the border lord's offer. | consummation |
| RMT-12 | 20-22 | Both | The border lord reveals Caen's name was on a rebel kill list; Vela cannot reconcile this with her brother's memory; they part. | dark-moment |
| RMT-13 | 23-24 | Vela | External all-is-lost: rebels retake Vela; empire moves to crush the rebellion. | (separated) |
| RMT-14 | 25-26 | Vela then Caen | Internal forced truths: Vela admits she has been using her brother's death as a permanent permission slip; Caen admits he served an empire he no longer believed in. | (turning) |
| RMT-15 | 27-28 | Both | Reunion; they choose each other across both factions. | reunion |
| RMT-16 | 29-30 | Both | Bonded stand: they convene the rebels and the empire's border garrison and force a parley. | bonded-stand |
| RMT-17 | 31 | Both | Aftermath; both factions punish them as traitors. | (settling) |
| RMT-18 | 32 | Vela | They ride out together to a third country. | (steady, series-open) |

External promises (5): rebellion, empire pursuit, border lord, brother's
death, sister's death. Resolution: rebellion + empire = parley; border
lord = exposed; brother + sister = forgiveness arc internalized. Romance
ladder: noticing → testing → orbiting → pulling-close → first-
vulnerability → public-allyship → shared-shadow → consummation → dark-
moment → reunion → bonded-stand. All stages hit. Trope required-beats:
all 7 hit at expected zones.

**Example RMT-B.** Subgenre: slow-burn romantasy. Completeness:
single-chapter beat plan for RMT-09 (shared-shadow).

Chapter (RMT-09 slot, "Shared shadow").

- Scene 1 (`goal`: protagonist asks the love interest about a scar;
  `opposition`: love interest does not want to discuss it;
  `turningPoint`: the love interest's response makes the protagonist
  realize the scar was inflicted by someone the protagonist trusts;
  `crisisChoice`: protagonist decides whether to confront or hold;
  `climaxAction`: holds, but with new information weighing on her;
  `resolution`: love interest sees that protagonist now knows.
  `relationshipValueIn`: distance; `relationshipValueOut`:
  closeness shadowed by a new external problem. `consequence`:
  setup for the dark-moment separation.)
- Scene 2 (`goal`: protagonist confronts the trusted-figure;
  `opposition`: trusted-figure deflects; `turningPoint`: trusted-
  figure's deflection itself confirms the love interest's account;
  `crisisChoice`: protagonist decides between her old loyalty and
  her new one; `climaxAction`: postpones the choice; `resolution`:
  trusted-figure registers the postponement as a threat.
  `valueIn`: trust; `valueOut`: doubt. `consequence`: the trusted-
  figure begins moving against the lovers' alliance.)
- Scene 3 (`goal`: protagonist returns to the love interest;
  `opposition`: the love interest expects to be abandoned;
  `turningPoint`: protagonist articulates that she has not made
  her choice yet, but she is here; `crisisChoice`: love interest
  accepts the limited gift; `climaxAction`: love interest
  reciprocates with the rest of the story behind the scar;
  `resolution`: they sleep in the same room, separately.
  `relationshipValueIn`: closeness shadowed; `relationshipValueOut`:
  closeness deepened, but at risk. `consequence`: setup for
  RMT-11 consummation (vulnerability now matched).)

---

## Method Pack: Heist Fantasy v0

### Identity

- **Genre family:** Heist fantasy. A team plans, executes, and survives
  the aftermath of a high-stakes theft, infiltration, con, or
  extraction in a fantasy setting. References (form): Scott Lynch's
  *Lies of Locke Lamora*, Brent Weeks's *Lightbringer* sub-arcs,
  Brandon Sanderson's *Mistborn*, Leigh Bardugo's *Six of Crows*.
- **Reader contract:** *I will watch a crew with named skills assemble
  for a job that the reader believes is impossible; I will see the
  setup beats whose payoffs I missed at the time, executed in the
  reveal beats; the team will pay a real cost.*
- **Disqualifying violations:**
  - Crew has fewer than 3 named members with distinct competences.
  - Reveals are not foreshadowed (the genre fails on "they had a
    plan that was never set up").
  - Heist is straightforward (no twist, no betrayal-or-feint).
  - All members survive intact and the costs are decorative.
  - Magic solves the heist without specific build/limit setup.

### Parameters (planner inputs)

| Parameter | Default | Notes |
| --- | --- | --- |
| Chapter count | 30-42 | Heist needs setup; longer than thriller. |
| Word count target | 100k-130k | Single-volume heist. |
| POV mode | Multi (limited to crew) | 3-5 POVs typical. |
| Magic system stance | Hard | Heist relies on system literacy. |
| Romance weight | None to B-plot | A-plot turns this into RMT v0 with heist as B. |
| Mortality stance | varies | Pulp-safe Mistborn-shape vs. realistic Six-of-Crows. |
| Crew size | required (3-6) | each member has 1+ named competence. |
| Job target | required | named: object, person, secret, location. |
| Twist count | required (1-3) | declared before planning so debts are budgeted. |

### Pack-specific schema overlay

- `crewRoster[]` — list of `{memberId, name, role, namedCompetence,
  ownStrategyPacket, joinSlotId, payoutDebt}`.
- `setupRevealLedger[]` — list of `{revealId, setupSlotId,
  setupSceneId, revealSlotId, revealSceneId, depthOfHiding}`. Every
  reveal has its setup recorded ahead of time.
- `jobPlanDoc` — explicit plan document; the planner records the
  *plan as the team intends it* and the reader is shown some
  fraction (the rest is reveal material).
- `betrayalLedger[]` — optional list of in-crew or against-crew
  betrayals, each with its own setup-reveal pair.

### Chapter-function template

| Slot | Function | Required scene action | Character pressure | World pressure | Promise made/repaid | Diagnostic if missing |
| --- | --- | --- | --- | --- | --- | --- |
| HST-01 | Crew-leader baseline | Crew leader (the architect) shown competent at small-stakes job. | Want established. | World ruleset glimpsed. | Open: reader contract. | `endpointLanding`. |
| HST-02 | Job offer / job-by-necessity | The big job is named; crew leader is committed (paid, coerced, or motivated). | Hook installed. | Job target's defenses introduced. | Open: heist promise. | `causalMomentum`. **Hard slot.** |
| HST-03 | Crew assembly opens | Crew leader recruits first member (or first 2-3 members are existing). | Each member's ownStrategyPacket starts to surface. | Recruiting environments. | Setup: each crewMember.payoutDebt. | `characterMateriality`. **Hard slot.** |
| HST-04 | Crew assembly continues | Remaining members brought in; one recruit is reluctant. | Crew dynamics. | Each recruitment dramatizes a different domain. | Setup: crew chemistry. | `relationshipMovement`. |
| HST-05 | Job briefing | The plan is explained on-page (in part — some material is held back for reveals). | Each member gets a role. | Job target's full defenses dramatized. | Open: jobPlanDoc; setup: revealLedger items. | `worldAsEngine`. **Hard slot.** |
| HST-06 | Recon / first prep beat | Crew tests one assumption or gathers one critical piece of intel. | Specific competence shown. | World-rules tested. | Setup: revealLedger #1. | `causalMomentum`. |
| HST-07 | Setback during prep | A first thing goes wrong; the crew adapts. | Crew under stress. | World pushes back. | Setup: improvisation. | `arcStatePerBeat`. |
| HST-08 | Magic-system / build setup | The crew's specific magical lever is named, demonstrated, and limited. | Crew commits to a specific approach. | World-rules constrained. | Open: magic-cost gate (per THF). | `worldAsEngine`. **Hard slot.** |
| HST-09 | The job, opening phase | The heist begins; the reader sees only the visible plan. | Adrenaline; tight POV. | World defenses hostile. | Repaid (partial): jobPlanDoc visible portion. | `causalMomentum`. **Hard slot.** |
| HST-10 | First reveal | A member's "secret prep" pays off; reader recognizes a setup beat. | Recognition. | World rule subverted. | Repaid: revealLedger #1. | **Hard slot.** Reveal must have setup. |
| HST-11 | Mid-job complication | Something happens the crew did not plan for. | Improvisation under pressure. | World provides surprise. | Setup: real-or-feint twist. | `causalMomentum`. |
| HST-12 | Twist #1 | The first twist fires (an opposing crew, an inside threat, a target reclassification). | Lie cracks. | World's reality shifts. | Repaid (subverted): jobPlanDoc theory. | `endpointLanding`. **Hard slot.** |
| HST-13 | Cost paid | A crew member is hurt, captured, or killed. | Grief or fear. | World extracts cost. | Repaid: payoutDebt (partial or full per member). | `relationshipMovement`. **Hard slot.** |
| HST-14 | Recommitment | Surviving crew chooses whether to continue. | Need surfaces. | World accepts the pivot. | Open: revised plan. | `arcStatePerBeat`. |
| HST-15 | Second reveal / feint | A second prep-beat pays off — possibly by the architect, possibly by a crew member acting independently. | Recognition + surprise. | World rule used in reverse. | Repaid: revealLedger #2. | **Hard slot.** |
| HST-16 | Final approach | Last phase of the heist; cost named; magic-cost paid in advance. | Resolve. | World defenses maximal. | Setup: climactic reveal. | `proseReadiness`. |
| HST-17 | Climactic reveal | The deepest setup beat fires (the architect's plan was always different from what the reader saw). | Defining choice executed. | World rule's deepest application pays. | Repaid: revealLedger #N (deepest). | **Hard slot.** Hardest reveal must have the earliest setup. |
| HST-18 | Aftermath | Crew survives or doesn't; cost is named; the target's value is questioned (genre-typical). | Quiet. | World post-heist. | Repaid: heist promise; reader contract. | `endpointLanding`. **Hard slot.** |
| HST-19 | Coda / next-job hook | Final image; if a series, a new offer is on the table. | Quiet. | World coda. | Open or Repaid: series-promise. | `proseReadiness`. |

### Scene contract

- **Dramatic completeness:** v1 contract. Plus: every reveal-scene
  declares `revealId` and `setupSceneId` so the trace is auditable.
- **Value charge:** mid-job scenes turn on `success-failure`,
  `freedom-slavery`, `truth-lie`. Reveal scenes turn polarity sharply
  (the situation looked one way and is now another).
- **MICE thread:** Event thread dominates during the job; Idea/Inquiry
  during prep and reveals; Character per crew member; Milieu (the
  target's place) is a dominant subordinate thread.
- **Promise/payoff bookkeeping:** every entry in `setupRevealLedger`
  is a `storyDebtId`. Unmatched setups (setup with no reveal) or
  unmatched reveals (reveal with no setup) = pack failure.

### Character pressure rules

- **Want vs. need:** crew leader's want is "complete the job"; need is
  almost always "accept that the job costs more than the pay."
  Each crew member has their own want/need pair.
- **Agency floor:** every named crew member must perform at least one
  decisive plot-action (a competence-deployment that materially
  affects the outcome).
- **Relationship movement:** at least 2 cross-crew relationships move
  through one full state change.

### Worldbuilding pressure rules

- **New-element introduction cadence:** all magic-system rules used in
  reveals must be introduced by HST-08. Introducing a new rule at
  HST-15 or later = pack failure.
- **Cost-of-magic:** mandatory; per THF rules.
- **Job target detail:** the target's defenses are shown in HST-05; no
  defense is invented at HST-09 onward without an earlier reveal.

### Diagnostics

1. `setupRevealIntegrity`: every reveal has a setup beat ≥3 slots
   earlier; every setup beat in `setupRevealLedger` is paid off.
2. `crewCompetenceUse`: every named crew member's `namedCompetence` is
   used decisively in at least one scene.
3. `magicSystemConservation`: no system rule used after HST-08 was
   introduced after HST-08.
4. `costPaid`: HST-13 dramatizes a real cost (member hurt, captured,
   or lost); decorative wounds = pack failure.
5. `twistEarning`: each declared twist has setup (per
   `setupRevealLedger`) and pays off the trust the reader extended.

### Anti-patterns

- "Caper without a price."
- Crew member with no distinguishing competence.
- Reveal that depends on a rule introduced in the same chapter.
- "It was the architect's plan all along" with no clue trail.
- Betrayal that has no setup wound or motive.
- Magic-resolved heist (a teleport, a memory-wipe, a charm) with no
  cost.
- Job target value not interrogated (cozy-heist failure).
- "The real treasure was the friends we made" without bittersweet
  cost.

### Synthetic golden examples

**Example HST-A.** Subgenre: Mistborn-flavor crew heist. Length:
19-slot spine, 36 chapters. POV: 4 crew POVs (architect Jeren,
infiltrator Sasha, fixer Ostwen, mage-specialist Ana).

`crewRoster`:

- Jeren: architect, named-competence "reads peoples' tells";
  payoutDebt "his sister's freedom from a mining camp."
- Sasha: infiltrator, named-competence "magical rope-and-anchor
  acrobatics"; payoutDebt "false papers for a foreign noble."
- Ostwen: fixer, named-competence "knows every black-market broker
  in the city"; payoutDebt "killing the broker who maimed his
  brother."
- Ana: mage-specialist (illusion-magic), named-competence "soft
  illusions that decay if witnessed under direct attention";
  payoutDebt "research access to a sealed library."

`setupRevealLedger`:

- R1 (depthOfHiding=shallow): in HST-06, Ana shows that her
  illusions decay under direct attention. Reveal: in HST-10, the
  crew uses the decay mechanic to make a guard *look away* by
  forcing him to second-guess himself.
- R2 (depthOfHiding=medium): in HST-07, Sasha leaves a backup
  rope-anchor "by accident" in a ventilation shaft. Reveal: in
  HST-15, this anchor is used by a different member (Ostwen) to
  escape an unrelated capture.
- R3 (depthOfHiding=deep): in HST-04 (crew assembly), Jeren reads
  one of Ostwen's tells and quietly notes it. Reveal: in HST-17,
  Jeren's *real* plan was to anticipate Ostwen's moment of
  betrayal — which is itself a real, motivated choice on Ostwen's
  part — and let the betrayal *be* the heist's success move.
  Ostwen's payoutDebt is paid by being allowed to walk away with
  what he wanted; the real target was something else entirely.

Slot map (highlights):

| Slot | Chapter | POV | Scene function | Reveal/Setup |
| --- | --- | --- | --- | --- |
| HST-01 | 1 | Jeren | Small-stakes con; Jeren reads a magistrate. | Crew-leader baseline. |
| HST-02 | 2-3 | Jeren | The big job: steal a sealed magistrate's testament that names the Lord Steward as conspirator. | Open: heist promise. |
| HST-03 | 4-5 | Jeren | Recruits Ostwen, then Ana. | Setup: payoutDebts. R3 setup (Jeren reads Ostwen). |
| HST-04 | 6-7 | Sasha | Recruited under duress; first chapter from Sasha's POV. | Setup: trust gap. |
| HST-05 | 8-10 | All | Job briefing in the safehouse; reader sees the plan minus key elements. | Open: jobPlanDoc. |
| HST-06 | 11 | Ana | Recon: Ana's illusion limits demonstrated in a market test. | R1 setup. |
| HST-07 | 12 | Sasha | Sasha's rope-anchor "lost" in vent system. | R2 setup. |
| HST-08 | 13-14 | Ana | The magical lever: Ana explains how her illusions work, and what they cost (her own clarity for hours after). | Magic-cost gate established. |
| HST-09 | 15-17 | All | Heist opens. Crew enters the magistrate's house. | Repaid (partial): visible plan. |
| HST-10 | 18 | Ana | R1 fires: guard is fooled by a decaying illusion. | Repaid: R1. |
| HST-11 | 19-20 | Sasha | Mid-job complication: a second crew is also infiltrating. | Setup: twist #1. |
| HST-12 | 21 | Jeren | Twist #1: the second crew is from the Lord Steward, who has been waiting. | Repaid (subverted): jobPlanDoc theory. |
| HST-13 | 22-23 | Ostwen | Cost paid: Ana is captured by the Steward's crew; Ostwen is offered her life if he betrays. | Repaid: payoutDebt-Ana (partial). |
| HST-14 | 24 | Jeren | Crew regroups; Jeren names the new plan. | Open: revised plan. |
| HST-15 | 25-26 | Ostwen | R2 fires: Ostwen escapes capture using Sasha's "lost" anchor. | Repaid: R2. |
| HST-16 | 27-28 | All | Final approach: rescue + heist completion. | Setup: climactic reveal. |
| HST-17 | 29-31 | Jeren | R3 fires: Jeren reveals that he counted on Ostwen's betrayal and on the Steward's surveillance; the real target was the Steward's seal-press, not the testament. The testament was the bait. | Repaid: R3 (deepest). |
| HST-18 | 32-34 | All | Aftermath: Ana lives, altered. Ostwen is allowed to walk with the broker's name. The seal-press is in Jeren's hands, which means the Lord Steward can be impersonated. The "real" job's real cost is named: Jeren has built a tool he is afraid of. | Repaid: heist promise; reader contract. |
| HST-19 | 35-36 | Jeren | Coda. Jeren's sister freed. The seal-press waits in a vault. A new offer arrives. | Series open. |

Setup-reveal ledger: 3 reveals, 3 setups, depth varying (shallow,
medium, deep). Crew competence: all 4 used decisively. Magic-cost: paid
(Ana). Cost paid: HST-13 fully dramatized (Ana captured and altered).

**Example HST-B.** Subgenre: short heist (novella-shaped). Completeness:
slot-compression chart for a 12-chapter novella.

```
Slot | Mapped chapter
-----|-----
HST-01 | 1
HST-02 | 1 (ending)
HST-03 | 2
HST-04 | 2
HST-05 | 3
HST-06 | 4
HST-07 | 4 (ending)
HST-08 | 5
HST-09 | 6
HST-10 | 6 (mid)
HST-11 | 7
HST-12 | 7 (ending)
HST-13 | 8
HST-14 | 9
HST-15 | 9
HST-16 | 10
HST-17 | 11
HST-18 | 12
HST-19 | 12 (ending)
```

Note: novella-length heist requires HST-04 and HST-15 to be folded
into other slots; the pack tolerates this provided
`setupRevealLedger` integrity is preserved.

---

## §11 Modifier Packs (Grimdark, Sword & Sorcery / Pulp)

These two requested genres are best handled as **modifier packs** that
overlay onto an existing pack rather than as standalone pipelines. The
reasoning:

- **Grimdark** is a tonal/cost overlay (moral grayness + escalation
  discipline + payoff with cost) that applies to CFA, EPI, THF, or LRP
  spines. It does not change the slot structure. Encoding it as a
  separate pack would duplicate work and risk slot drift.
- **Sword & Sorcery / Pulp Adventure** is an episodic-cadence overlay
  on CFA (lean cast, set-piece-per-chapter, low character-arc weight,
  high competence-porn weight). The Salvatore reference cited in the
  prompt is structurally CFA with these overlays; the corpus already
  uses CFA's slot vocabulary for it.

A modifier pack is a small JSON-ish constraint set the planner applies
on top of a base pack. Both modifiers are listed below at lower fidelity
than the standalone packs.

### Grimdark Modifier (overlay onto CFA, EPI, THF, or LRP)

| Field | Value |
| --- | --- |
| `mortalityStance` override | realistic-to-grimdark; cost must be paid every act-turn. |
| `protagonistMoralFloor` | "morally gray, not heroic"; protagonist must take at least one action in slot range mid-third that the reader recognizes as morally compromised. |
| `escalationCeiling` | every act-turn must include a permanent loss. |
| `redemptionPosture` | optional: "redemption-without-restoration" allowed, "earned-redemption" forbidden. |
| Anti-patterns added | "edgy without consequence" — graphic violence with no paid cost; "dark for dark's sake" — cynicism not earned by character interiority. |

### Sword & Sorcery / Pulp Adventure Modifier (overlay onto CFA)

| Field | Value |
| --- | --- |
| Cast size | ≤3 named recurring characters; protagonist + 1-2 companions. |
| Chapter cadence | episode-shaped; each chapter is a self-contained set-piece with a clean closure (the next-chapter hook is small). |
| Character-arc weight | low; protagonist's lie/truth pair may resolve only across multiple books. |
| Competence-porn weight | high; protagonist's named competences (sword, lockpicking, lore) are exercised every 2-3 chapters. |
| Set-piece cadence | one major set-piece per ~3 chapters; climactic arc-ending set-piece per book. |
| Ending shape | "victory at cost, world unchanged"; series-open without overarching cosmological stakes. |
| Anti-patterns added | "epic creep" — cosmological stakes introduced; "arc bloat" — protagonist's lie/truth paid off in chapter 8 of book 1. |

Both modifiers should have their own diagnostic-only POC before being
treated as named flags in any planner runtime.

---

## §12 Cross-Pack Diagnostics

Diagnostics that apply across all packs and would be especially useful as
shared semantic-judge extensions on top of v1's existing rubric.

| Diagnostic | What it checks | Packs primarily benefiting |
| --- | --- | --- |
| `noNewEntitiesPostSPP` | No characters or operating rules introduced after the slot at ~75% of the spine (Brooks's hardest deterministic rule). | All packs. |
| `promiseScaleMatch` | Major promises pay off at scale (a major question paid in two sentences = `payoff_undersized`). | All packs, especially LRP and HST. |
| `obligatorySceneCoverage` | Coyne's obligatory scenes for the genre are present at the expected slot ranges. | THF, RMT, LRP. |
| `microMonotony` | No 3+ consecutive scenes with same value-charge polarity (suppressed by `tragedyMode` flag). | All packs. |
| `relationshipMaterialFiring` | Where the scene contract claims a relationship is materially active, the relationship moves. | All packs but especially RMT. |
| `magicCostGate` | Every magic use has a cost recorded within 2 slots. | THF, LRP, HST, EPI. |
| `clueLandedCheck` | Every `clueLedger` entry observed by reader before solution slot. | CMF; secondary HST. |
| `harmonMirrorPair` | Slots at 1↔5/2↔6/3↔7/4↔8 percentage positions show symmetry (a cheap LLM check). | EPI, CFA, RMT. |

These are deferred to per-pack diagnostic implementations rather than
treated as v2 of CFA's rubric, because not every pack benefits equally.

---

## §13 Recommendations

### Recommendation R1: Wire the v0 method-pack judge prompt to all 7 new packs as a parallel diagnostic run

- **Layer optimized:** L2 (planning-quality measurement)
- **Exact proposed change:** Run the existing `method-pack-planner-semantic-judge-v0` prompt with each pack's strategy packet and slot map applied. No code changes to the planner itself; add the packs as data files under `docs/method-packs/<slug>-v0.md` and run the diagnostic in the existing fixture pipeline.
- **Expected storytelling benefit:** Establishes whether genre-specific packs improve plan-readiness over CFA v1 *for the same genre fixture*. Without this, every individual pack remains conjecture.
- **Downstream risks:** Multiple packs bidding for planner-default status creates cohort confusion; mitigated by treating each pack as an independent A/B against CFA v1, not against each other.
- **How to test it cheaply:** 3-6 frozen disposable concepts per pack family; AB/BA swap control judge runs at $0.04-0.10 per pair; total under $2 per pack family at v0 sample sizes.
- **What data would prove value:** method arm wins at least 2/3 of pairs vs. CFA v1 with mean delta ≥ +2 on the 25-point scale, position-bias < 25%, calibration pairs ≥ 2/3 TIE.
- **What should remain unchanged:** writer prompts, checker thresholds, planner runtime defaults, model policy.

### Recommendation R2: Build a pack-selector heuristic from the seed's `genre` field, but keep selection diagnostic-only

- **Layer optimized:** L1 (concept-phase routing)
- **Exact proposed change:** A small mapping `(seed.genre, seed.subgenre) → methodPackId` with a fallback to CFA v1 when no genre-specific pack matches. Selector runs at concept phase and writes the chosen pack to the strategy packet's `methodPackId` field. **Selector emits a recommendation; operator confirms before planning runs.**
- **Expected storytelling benefit:** the planner consults a genre-appropriate slot template instead of always defaulting to CFA. Reduces "thriller plotted as fantasy adventure" failure mode.
- **Downstream risks:** auto-selection without confirmation causes planner runs to silently swap method packs between fixtures, breaking attribution; mitigated by requiring operator confirmation step.
- **How to test it cheaply:** Implement the selector logic; run 10 frozen concepts spanning all 5 subgenres; measure operator-confirmation agreement rate. Under $2 (no LLM cost in selector itself).
- **What data would prove value:** operator confirms ≥80% of selections; for the 20% they don't, captures a labelled set of seed→pack mappings to refine the selector.
- **What should remain unchanged:** the selector does not change the planner's prompts; it only chooses which pack's slot template the planner consults.

### Recommendation R3: Add a `noNewEntitiesPostSPP` deterministic check across all packs

- **Layer optimized:** L2 (deterministic structural gate)
- **Exact proposed change:** A deterministic checker that diffs `establishedFacts`, `charactersPresent`, and `worldFactId` references across slots and flags any introduced after the slot mapped to ~75% of the spine. Brooks's hardest deterministic rule.
- **Expected storytelling benefit:** Catches the most common "late-introduced helper / late-introduced rule" failure mode that semantic judges miss because they treat the late entity as just another item in the plan.
- **Downstream risks:** false positives on legitimate red-herring reveals (where a character hinted at earlier becomes named late); mitigated by requiring the planner to declare hint-references in the strategy packet.
- **How to test it cheaply:** Run on existing diagnostic fixtures; compare flagged plans against operator review labels. Under $0.25 per fixture (deterministic; no LLM).
- **What data would prove value:** ≥70% of operator-flagged "late-introduced" plans caught; ≤10% false-positive rate against operator-approved plans.
- **What should remain unchanged:** planner prompts; the check fires post-plan as a diagnostic.

### Recommendation R4: Build the cross-pack `obligatorySceneCoverage` checker from Coyne's tables

- **Layer optimized:** L2 (genre-conformance diagnostic)
- **Exact proposed change:** Encode Coyne's per-genre obligatory-scene tables (action, thriller, fantasy-realm, romance, mystery, performance/LitRPG) as data; a checker LLM call asks "which slot dramatizes obligatory scene X? null if missing" per genre. Plug into the existing planner-readiness rubric.
- **Expected storytelling benefit:** Catches missing genre-defining scenes that semantic judges might overlook because the plan can be schema-complete without honoring the genre contract (e.g., a thriller missing "hero at the mercy of villain").
- **Downstream risks:** over-fidelity (every checkbox ticked = formulaic); mitigated by also flagging plans with all conventions and zero subversions.
- **How to test it cheaply:** ~$0.15 per fixture (1 LLM call per genre table per plan, only the relevant table active). Run on 30 frozen concepts across 5 subgenres; compare flagged plans to operator review.
- **What data would prove value:** ≥60% of operator-identified "missing obligatory scene" cases flagged; ≤15% false positives.
- **What should remain unchanged:** planner prompts (the check fires post-plan); operators retain authority to dismiss the check on a case-by-case basis.

### Recommendation R5: Promote the `magicCostLedger` from THF/LRP/HST into a shared L2 diagnostic

- **Layer optimized:** L2
- **Exact proposed change:** Pull the magic-cost ledger schema from THF v0, LRP v0, and HST v0 into a shared diagnostic that runs whenever a pack declares `magicSystemStance: hard`. Diagnostic verifies every magic use has a cost recorded within 2 slots.
- **Expected storytelling benefit:** Catches the "free magic" failure mode that drives reader complaints in commercial fantasy; especially valuable for thriller and progression where cost-of-power is load-bearing.
- **Downstream risks:** over-firing on legitimate hand-waved magic (the soft-magic case); mitigated by activating only when magicSystemStance is hard.
- **How to test it cheaply:** Score against existing thriller/LitRPG fixtures; ~$0.05 per fixture. Under $2 per pack family.
- **What data would prove value:** plans flagged by the ledger correlate with operator "free-magic" critiques at ≥0.5; mean planner score on `worldAsEngine` improves on cleared plans.
- **What should remain unchanged:** soft-magic packs (CMF, RMT) do not run this diagnostic.

### Recommendation R6: Run a single framework-to-prose POC on Cozy Mystery Fantasy v0 first

- **Layer optimized:** L2 → L6 transition (planning-to-prose)
- **Exact proposed change:** Use CMF v0 as the first pack to test the full framework-to-prose path. Pick one of the synthetic CMF examples; run the planner with CMF v0 active; draft chapters 1-3 with the existing writer; compare with CFA v1 control on the same concept.
- **Expected storytelling benefit:** Cozy mystery is the genre with the **most distinctive failure modes** (clue-fairness, magic-not-solution, community-restoration) and the **least overlap with CFA v1**, so a CMF win or loss is highly informative. LRP would also be informative but is gated by CLAUDE.md's standing constraint against LitRPG defaulting.
- **Downstream risks:** cozy mystery may have low audience-fit with the harness's commercial focus (fantasy/gamelit); mitigated by treating this as a methodology test, not a commercial bet.
- **How to test it cheaply:** ~$1.50 per chapter draft × 3 chapters × 2 arms = ~$9. Pre-authorize via the cost-threshold autonomy rule (over $2 per run; check-in required).
- **What data would prove value:** semantic judge prefers CMF arm 2/3 of paired runs; operator reviews scene-by-scene and prefers CMF arm; checker-blocker rate not worse on CMF arm.
- **What should remain unchanged:** writer model, checker thresholds, model policy.

### Recommendation R7: Defer Grimdark and Sword-Sorcery as standalone packs; ship them as modifier flags only

- **Layer optimized:** L1 (concept-phase tagging)
- **Exact proposed change:** Add `seed.modifierFlags: ['grimdark' | 'sword-sorcery-pulp']` as optional fields. Packs consume the flag and apply the §11 modifier overlay. No new method-pack files yet.
- **Expected storytelling benefit:** Captures the requested genre coverage at lower cost than full packs, while keeping the methodology stack lean.
- **Downstream risks:** Flag-based modifiers can drift from the spec they encode; mitigated by treating modifier flags as diagnostic-only and requiring an operator review of any flagged plan before drafting.
- **How to test it cheaply:** Apply each flag to a CFA v1 fixture and run the v0 method-pack judge. Under $0.50 per pair.
- **What data would prove value:** flagged plans show movement on the modifier's intended axis (e.g., grimdark plans show more cost-paid scenes; sword-sorcery plans show more set-piece-per-chapter cadence) without breaking the underlying CFA structure.
- **What should remain unchanged:** the underlying CFA v1 pack itself.

### Recommendation R8: Keep CFA at v1; do not produce v2 until ≥2 genre-specific packs clear the v1 evidence gate

- **Layer optimized:** L0 (methodology process discipline)
- **Exact proposed change:** Defer any CFA v2 work; treat the genre-neutral pack as stable-by-default. Re-open if a cross-pack diagnostic reveals a deficiency that genre-specific packs cannot fix locally.
- **Expected storytelling benefit:** Avoids spending review cycles on a v2 that may not be informed by real cross-pack evidence; preserves attribution by keeping the genre-neutral baseline stable.
- **Downstream risks:** A genuine deficiency in CFA v1 could persist undetected; mitigated by R3 and R4 cross-pack diagnostics, which would surface a CFA-wide issue.
- **How to test it cheaply:** Free; this is a process discipline.
- **What data would prove value:** No v2 needed if at least 2 of {PFA, EPI, THF, CMF, LRP, RMT, HST} clear v1's evidence gate without any of them blaming a CFA-shaped issue.
- **What should remain unchanged:** the v1 pack as the genre-neutral default and as the diagnostic baseline.

### Recommendation R9: Add the 7 new packs as `docs/method-packs/<slug>-v0.md` files mirroring CFA v1's shape, derived from this charter

- **Layer optimized:** L0 (artifact ergonomics)
- **Exact proposed change:** Generate 7 method-pack charter files in `docs/method-packs/` from this document's per-pack sections. Each file uses the v1 frontmatter (`status: draft`, `role: method-pack-charter`, `methodPackId: <slug>-v0`).
- **Expected storytelling benefit:** Operators and the planner-diagnostic runner can treat each pack as a discrete artifact with its own evidence gate, rather than chasing a single oversized doc.
- **Downstream risks:** doc proliferation; mitigated by updating `docs/method-packs/` index (if exists) and linking from `docs/decisions.md`.
- **How to test it cheaply:** Free, doc-only.
- **What data would prove value:** each pack file is independently citeable from a session-doc or a diagnostic run.
- **What should remain unchanged:** CFA v0 and v1 files, including their evidence trail.

### Recommendation R10: Sequence the rollouts so PFA, CMF, and RMT lead

- **Layer optimized:** L0 (cohort sequencing)
- **Exact proposed change:** Run R1's diagnostic on PFA v0, CMF v0, and RMT v0 first. EPI and HST are second-wave (more crew/POV moving parts; harder fixtures). LRP is third-wave per CLAUDE.md's standing genre constraint. THF is in either the first or second wave depending on Coyne-coverage diagnostic readiness.
- **Expected storytelling benefit:** First-wave packs maximize learning per dollar — they are the most distinctive against CFA v1 and the least dependent on infrastructure not yet built.
- **Downstream risks:** if first wave fails uniformly, the methodology may need a different shape; mitigated by treating each pack as independent and not making cross-pack inferences from a single failure.
- **How to test it cheaply:** Total first-wave under $6 (3 packs × ~$2 per pack family at v0 sample sizes).
- **What data would prove value:** at least one first-wave pack clears the v0 evidence gate; if zero clear, methodology shape is suspect (escalate, do not proceed to second wave).
- **What should remain unchanged:** runtime defaults; writer model; model policy.

---

## §14 Open Questions

1. Cross-genre hybrid pack (e.g., Romantasy+Thriller-Fantasy)? Defer until
   the standalone packs clear evidence gates.
2. Pack-selector: LLM call vs. deterministic seed-field mapping?
   Recommendation: deterministic from operator-declared genre, LLM only as
   fallback for ambiguous seeds.
3. Promote `tropeSpec` (LRP, RMT) to a shared cross-pack artifact? Yes once
   ≥2 packs use a `tropeSpec`-shaped overlay; defer until the schema
   stabilizes.
4. Promote `clueLedger` (CMF) to shared diagnostic for any fair-play
   mystery sub-arc? Yes, but defer until CMF clears the evidence gate.

---

## §15 Methodology Discipline

This document is a decision artifact. No pack here is a runtime default;
no example is corpus-lifted prose. Promotion path per pack matches CFA v1:
planner-only diagnostic → blind pairwise judge runs → operator side-by-side
review → small framework-to-prose POC. Disqualifying violations are flags,
not blockers — operators may dismiss them, but a pack's promotion gate
cannot pass with unaddressed ones. Cost-threshold autonomy rule applies:
POCs under $2/run proceed without check-in; ≥$2/run requires check-in.
