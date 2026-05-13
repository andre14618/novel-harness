---
status: active
updated: 2026-05-12
role: genre-method-pack-charter
methodPackId: mercenary-progression-adventure-v0
genreProfileId: adult-guild-mission-progression-fantasy
---

# Mercenary Progression Adventure V0

This is the first genre-specific shaping pack after the L108 telemetry closure.
It is a production-path planning and plotline scaffold, not a writer voice
route, checker gate, or POC branch.

## Market Posture

- Audience: adult progression/adventure fantasy with male-market positioning.
- Reader-facing promise: capable protagonist, concrete mission, tactical
  problem solving, visible power/resource gain, and a hook into the next job.
- Pen-name posture: separate pen name; Novel Harness remains private production
  infrastructure.
- Book 1 boundary: no explicit harem positioning. Relationship pressure may
  exist, but the commercial promise is mission/progression/adventure.
- Validation boundary: Amazon/KDP category rank and comparable-title behavior
  are market signals, not proof of quality. KDP rank is relative and updates
  from customer activity, so this pack must still be validated against covers,
  blurbs, reviews, categories, and actual reader response.

Reference checks:

- KDP Sales Ranking: https://kdp.amazon.com/en_US/help/topic/G201648140
- Royal Road progression/adventure shelves: live genre-comparison inputs, not
  a promotion gate.

## Series Engine

Use a recurring guild, charter hall, mercenary company, or contract broker as
the series hub. Each installment is one contained paid mission that changes the
hero and the local world state.

Every installment should contain:

- external objective: the job is legible in one sentence;
- arena: new location, ruin, frontier site, road problem, monster territory, or
  faction-controlled zone;
- progression payoff: skill, technique, rank, tool, patronage, money, map,
  reputation, or resource unlock;
- party movement: one ally, rival, mentor, client, or crew tie shifts because
  of the mission;
- faction consequence: the job changes a local power balance or exposes a
  larger world pressure;
- next hook: the payoff creates the next contract, debt, threat, or invitation.

Dungeon/ruin exploration is a mission type inside this engine, not the whole
series structure. Academy, base-building, and sprawling chosen-one plots are
parked until the first repeatable job loop works.

## Book 1 Contract

Book 1 should sell the series engine with the simplest complete loop:

```text
outcast/under-ranked protagonist
  -> accepts a dangerous low-status contract
  -> enters a bounded arena with a small crew or forced partner
  -> discovers the job was mispriced or politically contaminated
  -> earns one progression payoff through a costly tactical choice
  -> returns to the hub with changed status and a worse next problem
```

The first novella should not try to resolve the whole world. It should prove
that one contract can be fun, consequential, and repeatable.

## Novella Shape

Use 8-12 chapters or chapter-equivalent story units. Keep each chapter
anchored to one job function:

| Slot | Job Function | Endpoint Test |
| --- | --- | --- |
| MPA-01 | Hub pressure | Hero needs money, rank, leverage, cure, pardon, or access. |
| MPA-02 | Contract offer | Job terms are clear, but one risk is hidden or minimized. |
| MPA-03 | Crew friction | Ally/rival/client pressure changes how the job must be done. |
| MPA-04 | Arena entry | New location rules constrain tactics immediately. |
| MPA-05 | First tactical win | Hero gains information or resource at a visible cost. |
| MPA-06 | Job complication | The mission target is not what the contract claimed. |
| MPA-07 | Progression trial | Hero must apply, refine, or unlock the core capability. |
| MPA-08 | Faction reveal | The job points to a patron, enemy, law, debt, or larger conflict. |
| MPA-09 | Contract climax | Hero completes, subverts, or renegotiates the objective. |
| MPA-10 | Return and next hook | Reward changes status and creates the next mission pressure. |

Slots may merge for shorter work, but Book 1 must preserve the full loop:
hub pressure, contract, arena, complication, progression payoff, consequence,
and next hook.

## Commercial Story-Shape V1 Fields

The production seed carries the chapter-function template in structured
`chapterContracts[]` fields, not only in prose notes:

- `structureSlotId`: the MPA slot, such as `MPA-01`;
- `jobFunction`: the commercial mission function for the chapter;
- `endpointTest`: the concrete condition the chapter endpoint must satisfy;
- `pressureFocus`: one to four pressure dimensions the scenes should make
  operational.

This is intentionally smaller than a rigid plot builder. It tells the planner
what job the chapter must perform, but leaves the scene count, exact obstacle,
dialogue, and prose execution to the normal planning and drafting path.

## Scene Contract Bias

Every scene should make at least one of these pressures operational:

- `objectivePressure`: what concrete job step is being attempted now;
- `tacticalConstraint`: what rule, terrain, enemy, clock, cost, or missing
  resource blocks the obvious solution;
- `progressionRelevance`: how the scene tests or advances the hero's
  capability, rank, tool, or resource economy;
- `allyMateriality`: how another character changes the available choice, cost,
  information, or risk;
- `factionPressure`: how the scene exposes a patron, rival crew, law, guild
  rule, local faction, or future antagonist.

Do not tag every scene with every pressure. The scene succeeds when at least
one pressure changes what the protagonist can do next.

## Harness Telemetry Packet

Use `test-drafting-isolated --quality-telemetry-packet` for drafting evidence.
Read the results through these genre-specific questions:

- `endpointLanding`: does each scene hand the next mission step a concrete
  consequence?
- `sceneDramaturgy`: does the job get harder, clearer, or more costly?
- `characterMateriality`: did the hero or ally materially alter the mission
  outcome?
- `worldFactPressure`: did guild law, faction interest, magic rules, terrain,
  contract terms, or monster ecology constrain action?

Word count is advisory. A longer scene is acceptable when the telemetry shows
earned tactical/progression pressure; it is not acceptable when it only repeats
contract terms, mood, or generic fantasy texture.

## Failure Modes

- Generic quest soup: the job is vague, noble, or epic instead of concrete.
- Stat-sheet bait: progression is promised but not dramatized through choices.
- Passive party: allies are present but do not alter tactics or costs.
- Decorative worldbuilding: ruins, factions, monsters, or guild rules do not
  constrain action.
- No return loop: the story ends without hub status change or next job pressure.
- Over-tagging: every detail receives a durable tag, making the writer carry
  bookkeeping instead of story pressure.

## First Plotline Target

The next harness lane should shape one Book 1 plotline from this pack before
running broad drafting. The target artifact is a compact contract packet:

- series promise;
- protagonist progression axis;
- guild/hub rule;
- Book 1 contract;
- arena and hidden complication;
- party relationship shift;
- faction consequence;
- next-mission hook;
- 8-12 chapter job-function outline;
- scene-level pressure notes for the first two chapters.

## Production-Path Book 1 Packet

The first executable Book 1 packet is:

- Packet artifact: `docs/fixtures/method-packs/mercenary-progression-adventure-v0/book1-contract-packet.json`
- Production seed: `src/seeds/mercenary-rillgate-saltmine.json`

The seed uses normal `SeedInput.directives`, not a POC runner. It carries:

- all ten MPA job-function slots as chapter-specific required beats;
- stable story refs for bronze rank, mispriced contract, Tessa-as-witness,
  and next-patron pressure;
- first-two-chapter pressure notes in `rawNotes`;
- default-off production flags for scene-turn shaping, material pressure, and
  tight-anchored writer briefs.

Evidence commands:

```bash
bun scripts/test-planner-isolated.ts mercenary-rillgate-saltmine \
  --scene-turn-planning \
  --material-pressure-planning \
  --report-dir output/planner-isolated/mercenary-rillgate

bun scripts/test-drafting-isolated.ts \
  --source <novel-id-from-planner> \
  --target-prefix mpa-rillgate \
  --quality-telemetry-packet
```

Successful planner-isolated runs now write `plan.html` in the report
directory. Existing persisted planner sources can be rendered again with:

```bash
bun run diagnostics:planner-outline-html -- \
  --novel <planner-novel-id> \
  --out output/planner-isolated/mercenary-rillgate/plan.html \
  --open
```

Promotion remains evidence-gated: the planner must preserve MPA-01 through
MPA-10, keep exact story refs, and first-chapter drafting telemetry must avoid
endpoint, dramaturgy, character-materiality, and world-pressure lows.

## Basic Planner POC

Fixture: `docs/fixtures/method-packs/mercenary-progression-adventure-v0/frozen-concept.json`.

The first frozen concept maps the series engine into six planner slots:
`MPA-01`, `MPA-02`, `MPA-04`, `MPA-06`, `MPA-09`, and `MPA-10`.
It uses a Rillgate salt-mine contract to test whether the planner can preserve
hub pressure, contract terms, arena rules, job complication, contract climax,
progression cost, return status change, and next-job pressure.

The 2026-05-12 live Flash diagnostic preserved all six slots and produced a
usable method-pack plan, but deterministic lift was ceilinged against a strong
control arm. The semantic AB/BA judge was position-biased, so the POC is a
clean planner-mapping artifact, not promotion evidence by itself.
