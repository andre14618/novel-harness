---
job: 4
title: Semantic Judge Design and Prompt Structure Critique
date: 2026-05-10
model: opus
status: draft (decision artifact, not promotion-ready)
---

# Job 4 — Semantic Judges and Prompt Structure Critique

## Operating premises

This artifact extends the calibration work in
`docs/evals/planner-discernment-calibration-v0.md`,
`docs/evals/planner-discernment-real-data-v0.md`, and the Plan-A bias finding
in `docs/sessions/2026-05-07-method-pack-planner-cohort.md`.

Three constraints govern every judge below:

1. **Narrow scope, single dimension, single excerpt.** Discernment v0 showed
   Flash hits 100% exact on dimension-specific calls while broad pairwise
   hits 18/18 first-position bias.
2. **Anchored categorical labels with explicit evidence requirements.** Open
   Likert scoring is rejected. Every judge emits a binary or 4-class
   anchored label whose levels are gated by evidence the model cites
   verbatim.
3. **Granularity stability is mandatory.** Per "Gold stability first",
   every judge specifies calibration-anchor AND production-emit
   granularity, and must verify J ≥ 0.85 at both. On FAIL, try data-only
   binary collapse before re-labeling.

The judges below are NOT continuity/hallucination/grayzone graders (per the
"no noisy LLM checkers" feedback). They score gaps that deterministic
checks cannot reach: endpoint landing, scene completeness, agency,
relationship movement. The deterministic substrate (outlines, beat IDs,
value-charge tags, McKee gaps, MICE threads) already exists; judges read
that plus the prose.

Cost: each judge specified for DeepSeek V4 Flash unless noted. Average
350-700 prompt / 40-150 output tokens. Full 7-judge × N=20 panel costs
~$0.30-$0.80 per pass — well under the $2 autonomy threshold.

---

# PART A — Narrow Semantic Judges

## Judge J1: Endpoint landing

### Purpose

Catches the gray-zone failure mode where the chapter's declared `purpose`
sets up a forward hook or consequence (per `chapter-outline-system.md` line
35-36's "NEVER close a chapter on pure description" / "forward hook" rule)
but the prose closes on description, vague resolution, or a beat that
glances off the declared endpoint without landing it. Deterministic checks
can verify a final paragraph exists; they cannot verify whether the prose
actually arrived at the consequence the planner promised.

This is the dimension that the discernment v0 fixture already calibrates
(`endpointLanding`, ENDPOINT-0..3), but the existing v0 runs that dimension
against PLANS, not prose. J1 inverts the surface: same anchored labels,
applied to the chapter's last 250 words read against the chapter's planned
purpose + the planned endpoint hook.

### Granularity

Calibration anchor: chapter-final excerpt (last 250 words) plus chapter
outline `purpose` and the next-chapter outline if available.

Production emit: same. The "production" granularity is intentionally
identical to the calibration granularity — this is one of the few dimensions
where chapter is the natural unit and there is no temptation to drift.

### Input shape

```json
{
  "chapterNumber": 7,
  "chapterPurpose": "<verbatim purpose string from chapter outline>",
  "nextChapterPurpose": "<verbatim purpose string from next chapter outline, or null if final>",
  "chapterFinalProse": "<last 250 words of chapter prose, verbatim>",
  "declaredHook": "<the hook fragment from chapter purpose if extractable, or null>"
}
```

Input is deterministic and small (~400 tokens). The chapter outline schema
already supplies `purpose`; the harness extracts the last 250 words by
character offset.

### Output shape

```json
{
  "label": "ENDPOINT-0" | "ENDPOINT-1" | "ENDPOINT-2" | "ENDPOINT-3",
  "evidence_quote": "<verbatim ≤30-word quote from chapterFinalProse supporting the label>",
  "missing_for_next_level": "<≤200 char description of what would need to be on the page to clear the next label up>",
  "abstain_reason": null | "<short reason>"
}
```

Binary collapse on calibration FAIL: ENDPOINT-{0,1} = LANDS_NO,
ENDPOINT-{2,3} = LANDS_YES. We use the 4-class output by default because
discernment v0 hit 100% exact on this dimension at 4-class granularity, but
the binary fallback exists if real-data J drops.

### Rubric (the prompt body)

```
You are a single-dimension structural judge for chapter endpoints.

You are given a chapter's planned purpose, the planned purpose of the next
chapter (or null if final), and the last 250 words of the chapter's prose.

Your job is to label the actual endpoint landing on this scale:

ENDPOINT-0: the closing prose lands on pure description, atmosphere, or
generic reflection. The declared purpose's consequence/hook is not enacted
on the page in the closing window.

ENDPOINT-1: the closing prose references the declared consequence/hook in
narration but does not enact it as an action, decision, or revelation.
Reader sees the planner's intent stated, not landed.

ENDPOINT-2: the closing prose enacts the declared consequence as an action
or interiority decision. A reader can name what changed and what is at
stake going into the next chapter.

ENDPOINT-3: the closing prose enacts the declared consequence AND adds
forward propulsion (a specific commitment, a named threat now active, a
choice the reader cannot yet predict the result of). The closing line
itself functions as a hook, not a summary.

Use the LOWEST label whose evidence requirements are FULLY satisfied. If
ENDPOINT-2's "enacted as action or interiority decision" is partly true
but the prose ends on description after the action, choose ENDPOINT-1.

Quote ≤30 words verbatim from chapterFinalProse to justify your label.
The quote must show what the prose ACTUALLY does, not what the planner
declared.

Do not score quality, voice, or pacing. Only endpoint landing.

Respond with ONLY valid JSON in this exact shape:
{
  "label": "ENDPOINT-<N>",
  "evidence_quote": "<verbatim quote>",
  "missing_for_next_level": "<what would need to be on the page>",
  "abstain_reason": null
}
```

Polarity-bias mitigations: the rubric never asks "is this a strong
ending?" (Likert prose-quality framing) — it asks whether specific listed
evidence appears. The "lowest label whose evidence requirements are
satisfied" instruction is the same anchor that produced 100% exact on the
floor calibration. The judge cannot win by hedging higher; the lowest-fit
rule pushes the model down on ambiguity.

### Calibration plan

- Anchor set size: 30 known-answer cases. 12 ENDPOINT-0 (description
  closes; "the harbor stretched cold and grey before her"-style fades), 8
  ENDPOINT-1 (narrator declares the consequence without enacting), 6
  ENDPOINT-2 (consequence enacted), 4 ENDPOINT-3 (consequence + propulsion).
  Drawn from existing chapter prose in `output/semantic-gate-baseline-*`
  and `output/corpus-recreation-poc/`, then operator-labeled.

- Granularity stability check: run the same 30 cases TWICE — once with the
  full chapter outline available as context, once with only the chapter
  purpose string and the next-chapter purpose. J ≥ 0.85 at both shapes is
  required. The "minimal context" run is the production-emit granularity;
  it must not drift more than one label off in 10% of cases vs. the full-
  context run.

- Position-bias controls: not applicable (single-excerpt judge, no A/B).
  However, run a calibration sub-panel of 8 same-prose / different-purpose
  pairs to verify the judge is reading the prose rather than echoing the
  declared purpose. Same-prose / weaker-purpose should not lift the label;
  same-prose / stronger-purpose should not lower it. If either drifts >1
  label on >2/8 cases, the judge is anchoring on the purpose text — fail
  calibration and rewrite the rubric to put the prose first.

- Failure mode if calibration fails: try data-only binary collapse to
  LANDS_NO / LANDS_YES. If that still fails, the dimension is too coarse
  and we re-label. Do NOT add a Pro pass — Flash failed at 4-class is a
  signal we are over-fitting the rubric.

### Stop conditions

- Chapter is < 600 words total: skip. The "last 250 words" window
  approaches the whole chapter and the judge cannot separate the endpoint
  from the body.

- Chapter `purpose` is missing or < 20 chars in the outline: skip. There
  is no declared endpoint to land against; emit `applicability_skip`
  rather than score.

- Chapter is the final chapter AND the novel is part of an unfinished
  series: judge differently — the rubric's "forward propulsion" anchor is
  inappropriate. Use a sibling J1' rubric (not specified here) or skip.

### Cost target

~500 prompt / ~80 output. ~$0.0008/call. N=20: ~$0.02.

---

## Judge J2: Scene dramatic completeness

### Purpose

Catches the gray-zone failure mode where a scene's beats render to prose
that LOOKS like a scene (dialogue, action, sensory detail) but contains no
value-charge shift, no real conflict, and no decision/revelation that
would justify it as a scene rather than a montage. Deterministic checks
can verify scene boundaries from `sceneId` + beat counts; the
`structure-value-charge` agent can corpus-tag value charges. What we
cannot deterministically check is whether the GENERATED scene's prose
actually delivers a value charge under the planner's declared scene
function.

This is the most important "is this prose actually doing scene work?"
sensor we can build cheaply. It directly addresses the "scenes saturate
at level 2" finding in `planner-discernment-real-data-v0` by moving the
judge from PLAN-text to PROSE-text — where saturation is less likely
because prose either dramatizes a turn or does not.

### Granularity

Calibration anchor: scene excerpt (full scene prose, typically 400-1200
words) plus scene-level metadata (POV, characters present, declared
scene function).

Production emit: same. Scenes are the natural unit.

### Input shape

```json
{
  "sceneId": "ch-007-scene-002-the-confrontation",
  "povCharacter": "Maret",
  "charactersPresent": ["Maret", "Cassel"],
  "declaredFunction": "<one-line plain-English description from scene contract: 'confrontation: Cassel pressures Maret for evidence; Maret evades but the lie cracks'>",
  "sceneProse": "<full scene prose verbatim>"
}
```

The `declaredFunction` field is reduced from the chapter outline / scene
plan to a single sentence by the harness before the judge sees it. This
is critical — we do not pass the full beat list, because that primes the
judge to verify beat coverage rather than dramatic completeness. The
judge sees only what a reader would: the scene prose, who is in it, and
a one-line summary of what the scene was supposed to do.

### Output shape

```json
{
  "label": "SCENE-0" | "SCENE-1" | "SCENE-2" | "SCENE-3",
  "value_axis": "<dominant value axis from {life-death, freedom-slavery, justice-injustice, love-hate, truth-lie, power-weakness, hope-despair, success-failure, belief-doubt, identity-unknown, none}>",
  "value_in_polarity": "+" | "-" | "0",
  "value_out_polarity": "+" | "-" | "0",
  "evidence_quote": "<verbatim ≤30-word quote from sceneProse showing the value shift, or showing the absence of one>",
  "abstain_reason": null | "<reason>"
}
```

Value axis enum is reused verbatim from `structure-value-charge/value-charge-system.md`
to keep judge labels comparable to corpus tags.

Binary collapse on FAIL: SCENE-{0,1} = INCOMPLETE, SCENE-{2,3} = COMPLETE.

### Rubric

```
You are a single-dimension judge for whether a scene functions as a scene.

A scene functions as a scene when ONE life value shifts polarity over the
course of the scene. A character or situation moves from + to −, − to +,
or has a new state become legible (0 → + or 0 → −). If no value moves,
the prose may have action and dialogue but does not earn its place as a
scene; it is montage or transition.

You are given the scene's prose, who is in it, and a one-line summary of
what the scene was supposed to do.

Label on this scale:

SCENE-0: no value shifts. The scene is informational, atmospheric, or
purely transitional. Characters speak or act but no axis moves; the
scene's situation at end equals its situation at start.

SCENE-1: a value SEEMS to shift in narration ("she felt her hope drain")
but no on-page action, dialogue, or decision dramatizes the shift.
Telling, not showing. A reader could not point to the moment of turn.

SCENE-2: a value clearly shifts on-page through action, dialogue, or
revelation. A reader can identify the moment of turn and the polarity
direction. The shift may be small.

SCENE-3: a value clearly shifts AND the shift carries decision or
revelation force — a character now has to act differently, or the scene's
truth has been redefined. The scene's end-state generates the next
scene's question.

Use the LOWEST label whose evidence requirements are FULLY satisfied.

Identify which value axis dominates the scene from this list:
life-death, freedom-slavery, justice-injustice, love-hate, truth-lie,
power-weakness, hope-despair, success-failure, belief-doubt,
identity-unknown, none.

Quote ≤30 words verbatim from sceneProse showing the polarity shift, or
showing the absence of one.

Do not score voice, prose quality, or whether the scene matches the
declared function. Only dramatic completeness via value charge.

Respond with ONLY valid JSON.
```

Polarity-bias mitigation: the rubric explicitly forbids the judge from
scoring against `declaredFunction`. The declared function is provided as
context but the judge is told not to score adherence — that is what
deterministic beat-coverage checks do. We separate "did the scene exist
as a scene?" from "did the scene match the plan?" because a method-pack
arm can be plan-adherent and dramatically empty (the v0 cohort finding).

### Calibration plan

- Anchor set size: 24 known-answer scene cases authored against the
  schema. 8 SCENE-0 (montage / info-dump / transition), 6 SCENE-1
  (told-not-shown shifts), 6 SCENE-2 (clear small shift), 4 SCENE-3
  (decision/revelation force). Drawn from a mix of corpus reference
  scenes (Salvatore bundle, Jane Austen public-domain) and synthetic
  failure cases authored to the schema.

- Granularity stability check: same 24 cases run twice — once with
  `declaredFunction` provided, once with `declaredFunction` blanked. The
  blanked-function run is the harder generalization test; J must hit
  ≥0.85 at both. If the blanked-function run hits significantly lower,
  the judge is using `declaredFunction` to guess, which is a calibration
  failure — rewrite to push the prose-evidence requirement harder.

- Position-bias controls: not applicable (single-excerpt). Add 6
  same-scene / different-`declaredFunction` adversarial cases: same prose,
  but `declaredFunction` deliberately mis-described. The judge should
  return the SAME label across the two runs. If it follows the function,
  fail calibration.

- Failure mode if calibration fails: collapse to binary INCOMPLETE/COMPLETE
  first. If binary still fails, separate into two judges: J2a "value-axis
  identification" (what moves?) and J2b "shift-on-page evidence" (is the
  shift dramatized vs told?). Both as binaries. Do not re-merge into a
  4-class until both J2a and J2b clear ≥0.90 alone.

### Stop conditions

- Scene < 200 words: skip. There is not enough prose to dramatize a value
  shift even when intended. Emit `applicability_skip`.

- Scene is explicitly tagged in the plan as `transitional` / `bridge`
  (`structure-mice` SECONDARY=null, `valueShifted=false` from beat
  expansion): expected SCENE-0 is intentional. Score it but flag as
  `intended_static` rather than as a quality issue.

### Cost target

~700 prompt / ~120 output. ~$0.0012/call. N=20: ~$0.025.

---

## Judge J3: Character agency

### Purpose

This is the dimension that the v0 real-data discernment found most
informative — `characterAgency` was already separating planner outputs at
the chapter level. J3 is the prose-layer twin: does the protagonist's
on-page action drive the scene's consequence, or does the protagonist
receive events / drift / observe?

The gray-zone failure mode this catches: a scene where the protagonist is
present, makes statements, even has interiority — but the scene's
consequence is delivered by NPCs, the world, or chance. The protagonist
is the camera, not the engine. The chapter's `purpose` says "Maret
confronts Cassel and forces a choice"; the prose says "Cassel interrogates
Maret; Maret answers; Cassel announces the investigation." Same beats,
opposite agency.

This judge is intentionally narrower than v0's `AGENCY-1..3` rubric. It
asks one question: at the scene's pivotal moment, who acts? If the
answer is "the protagonist, under pressure, with cost," it is high
agency. If the answer is "anyone else; or the protagonist by passive
response," it is low.

### Granularity

Calibration anchor: scene-level. Scene prose plus the named POV
character.

Production emit: same.

### Input shape

```json
{
  "sceneId": "ch-002-scene-001-arbiter-interview",
  "povCharacter": "Maret",
  "scenePurpose": "<one-line scene function as in J2>",
  "sceneProse": "<full scene prose verbatim>"
}
```

We deliberately do NOT pass the antagonist character profile, the world
bible, or the chapter's wider purpose. The judge needs only the prose
and the POV name to ask "who actually decides what changes?"

### Output shape

```json
{
  "label": "AGENCY-0" | "AGENCY-1" | "AGENCY-2" | "AGENCY-3",
  "pivotal_actor": "<verbatim character name from sceneProse who drives the consequence>",
  "pivotal_action_evidence": "<verbatim ≤30-word quote from sceneProse showing the pivotal action>",
  "abstain_reason": null | "<reason>"
}
```

Binary collapse: AGENCY-{0,1} = LOW, AGENCY-{2,3} = HIGH.

### Rubric

```
You are a single-dimension judge for protagonist agency in a scene.

You are given a scene's prose and the named POV character.

Identify the PIVOTAL MOMENT in the scene — the action, choice, or
revelation that determines what the scene's consequence will be. Then
identify who drove it.

Label:

AGENCY-0: the POV character is observer, witness, or recipient. The
pivotal action is performed by another character or by circumstance. The
POV may have interiority but does not act on it.

AGENCY-1: the POV character responds reactively. The pivotal moment is
delivered by another character; the POV's contribution is reaction
(answering a question, agreeing/disagreeing, complying). The POV could
be removed and another character could deliver the same response.

AGENCY-2: the POV character acts. The pivotal moment is initiated or
completed by a POV decision under pressure. There is at least one moment
where the POV chooses one path over another visible alternative.

AGENCY-3: the POV character acts AND pays a cost. The chosen action
forecloses an alternative the POV wanted (revealing what they wanted
to hide, accepting a danger, abandoning a relationship). The cost is
visible on the page.

Use the LOWEST label whose evidence requirements are FULLY satisfied.

Quote ≤30 words verbatim showing the pivotal action and who took it.

Do not score whether the action was correct, whether the scene was good,
or whether the POV's voice was distinct. Only agency in driving the
scene's consequence.

Respond with ONLY valid JSON.
```

Polarity-bias mitigation: the rubric explicitly excludes voice,
correctness, and prose quality. The "pivotal_actor" output field forces
the model to name a character before assigning a label, which prevents
the model from rounding up agency for sympathetic POVs.

### Calibration plan

- Anchor set size: 28 known-answer cases. 8 AGENCY-0 (POV observes;
  e.g., a character watches a duel they cannot affect), 8 AGENCY-1 (POV
  reacts; classic interrogation scenes where POV answers questions), 8
  AGENCY-2 (POV acts), 4 AGENCY-3 (POV acts at cost). Sourced from
  Salvatore reference (Drizzt is a useful AGENCY-2/3 calibration source),
  Austen (Elizabeth scenes for AGENCY-2/3, observer-Bingley scenes for
  AGENCY-0/1), and authored synthetic failures.

- Granularity stability check: run with the full POV character profile
  vs. with only the POV name. The judge should not need the character
  profile — agency is in the prose. If the J drops >0.05 absolute when
  the profile is removed, the judge is using profile context to guess.
  Calibration target: J ≥ 0.85 at the name-only run.

- Position-bias controls: not applicable. Add 6 swapped-POV adversarial
  cases — same scene, but the input declares a non-POV character as POV.
  In these cases the judge SHOULD return AGENCY-0 or AGENCY-1 (the
  declared POV is now an observer). If it returns ≥AGENCY-2 by latching
  onto the actually-pivotal character regardless of input, fail
  calibration and rewrite the rubric to make POV-as-input load-bearing.

- Failure mode: binary collapse to LOW/HIGH first. If binary fails,
  decompose into J3a "did POV act?" (binary) and J3b "did POV pay cost?"
  (binary), score independently.

### Stop conditions

- Scene has only one named character: skip. Solo scenes are
  AGENCY-3-by-default and the judge cannot distinguish action from
  drift cheaply. Use a sibling solo-scene rubric (not specified here)
  or skip.

- Scene is action-only with no decision moment (a battle scene where
  events resolve mechanically): the rubric handles this — the pivotal
  action is named — but flag for operator review on AGENCY-2 calls
  because the cost dimension is hard to verify in pure-action prose.

### Cost target

~700 prompt / ~100 output. ~$0.0011/call. N=20: ~$0.022.

---

## Judge J4: Relationship movement

### Purpose

The v0 real-data work flagged `relationshipDelta` as the strongest
ranking sensor for plans, but applicability filtering shrank the useful
sample. J4 is the prose-layer twin and inherits the applicability
discipline: it is run ONLY when the scene's plan declares a relationship
arc target between two named characters. It scores whether the scene's
prose actually moves the named relationship in the declared direction.

The gray-zone failure mode: the planner declares "Bruenor and Wulfgar
move from peer-rivalry to mentor-protégé"; the prose has Bruenor and
Wulfgar in the same scene, exchanging dialogue, even feeling something
about each other — but their relationship state at scene end is not
distinguishable from scene start. The relationship is referenced, not
moved.

This judge is also the test case for the v0 finding that the method
pack may be regressing relationship movement. If J4 reliably flags
relationship-static prose under applicability filtering, the planner
contract for relationship-bearing scenes can be revised before any
prose-layer change ships.

### Granularity

Calibration anchor: scene-level, with declared relationship arc as
required input.

Production emit: same. Applicability-gated.

### Input shape

```json
{
  "sceneId": "ch-007-scene-003-mentor-rebuke",
  "characterA": "Bruenor",
  "characterB": "Wulfgar",
  "declaredArcDirection": "<one-line: 'peer-rivalry → mentor-protégé', or 'trusting allies → strained allies', or 'romantic interest → declared romance', etc.>",
  "sceneProse": "<full scene prose verbatim>"
}
```

The `declaredArcDirection` is required. If the plan does not declare a
relationship arc for this scene with both A and B named, the judge does
not run.

### Output shape

```json
{
  "label": "REL-0" | "REL-1" | "REL-2" | "REL-3",
  "movement_direction": "matched" | "opposite" | "static" | "ambiguous",
  "evidence_quote": "<verbatim ≤30-word quote showing the relationship at scene start>",
  "evidence_quote_end": "<verbatim ≤30-word quote showing the relationship at scene end>",
  "abstain_reason": null | "<reason>"
}
```

Binary collapse: REL-{0,1} = STATIC, REL-{2,3} = MOVED.

### Rubric

```
You are a single-dimension judge for relationship movement in a scene.

You are given a scene's prose, the names of two characters whose
relationship the planner declared should move, and a one-line description
of the declared arc direction (the FROM-state and TO-state).

Your job: identify whether the prose actually moves the relationship.

Label:

REL-0: characters are co-present but the relationship is unchanged.
Status, leverage, trust, debt, suspicion, intimacy, or hostility level at
scene end equals scene start. Dialogue may exchange information without
moving the bond.

REL-1: characters react emotionally to each other but the underlying
relationship state does not change. They argue but do not change
position; they share warmth but do not deepen commitment; they are
suspicious but acquire no new evidence.

REL-2: the relationship moves on at least one of these axes: trust,
leverage, debt, alliance, intimacy, suspicion, hostility, deference,
loyalty. The change is visible through action or unambiguous dialogue.
The direction may or may not match the declared arc.

REL-3: the relationship moves AND a character explicitly adjusts behavior
toward the other based on the new state — hands a thing over, confides
something previously withheld, refuses to do what they previously would
have done, demands what they previously would have asked.

Then independently judge the direction:
- "matched": the movement matches the declared arc direction
- "opposite": the movement is the opposite direction (e.g., declared
  trust → strain, but prose shows distrust → trust)
- "static": no movement (REL-0 or REL-1)
- "ambiguous": the movement is real but does not align cleanly with the
  declared axis

Quote two ≤30-word fragments verbatim — one for the relationship state
at scene start, one for scene end.

Do not score voice, agency, or prose quality. Only relationship
movement and direction.

Respond with ONLY valid JSON.
```

Polarity-bias mitigation: the judge labels MAGNITUDE separately from
DIRECTION. This is the v0 lesson — coupling the two creates a "method
pack regression" framing artifact. By splitting, we let "the relationship
moved, but in the wrong direction" become a legitimate REL-3/opposite
output rather than collapsing to a low score that misattributes the
movement.

### Calibration plan

- Anchor set size: 32 known-answer cases. 8 REL-0 (static co-presence),
  8 REL-1 (emotional reaction without state change), 12 REL-2 (movement;
  4 matched / 4 opposite / 4 ambiguous), 4 REL-3 (movement + behavior
  shift; 3 matched / 1 opposite for direction-judge calibration).

- Granularity stability check: also run a beat-level variant on the
  pivotal beat in REL-2/3 cases. The beat-level run should hit J ≥ 0.85
  on the magnitude label vs. the scene-level scoring. If the beat-level
  judge over-labels (sees movement in beats that the scene-level judge
  does not), the rubric is over-sensitized to local emotional intensity.
  Re-anchor.

- Position-bias controls: not applicable. Add 6 swapped-arc-direction
  adversarial cases — same prose, declared arc reversed. The MAGNITUDE
  label should be unchanged; the DIRECTION label should flip from
  "matched" to "opposite". This validates the magnitude/direction
  separation.

- Failure mode: binary collapse to STATIC/MOVED on magnitude. Drop
  direction entirely if the direction-judge calibration fails — emit
  magnitude only and treat direction as operator-review work.

### Stop conditions

- Plan does not declare a relationship arc for this scene with both
  characters named: skip with `applicability_skip`. This is the
  applicability discipline from v0.

- Both characters are POV-non-POV in a scene where the non-POV is
  unconscious / restrained / bypassed: REL-0 by definition; flag for
  operator and skip the rubric to avoid wasting calls.

- Scene has 3+ named characters and the declared arc is between only
  two: still run, but flag in operator review queue — multi-character
  scenes are a known noisier surface for this judge.

### Cost target

~750 prompt / ~150 output. ~$0.0014/call. N=20: ~$0.028.

---

## Judge J5: Worldbuilding pressure

### Purpose

The v0 work added `worldFactPressure` for plans. J5 is the prose-layer
analog: when a world rule, magic system, political constraint, or
geographic fact is referenced in the scene prose, does that fact
constrain action / create cost / alter options / force a choice — or is
it decorative?

The gray-zone failure mode: the LitRPG / fantasy-system genre cohort
(`fantasy-system-heretic` etc.) is full of System mechanics, stat
references, and lore. Most of those mentions are decorative — the System
is named, but the System does not constrain the scene. A scene where
"Maret's Strength is recorded as three" is referenced in narration but
does not affect what Maret can attempt is a worldbuilding-decorative
scene, not worldbuilding-pressured. Deterministic checks can find the
fact mention. They cannot find whether the fact bit.

This is the dimension most directly in the genre-flexibility bucket.
The user's "Genre flexibility as design constraint" memory says L1 is
genre-neutral and L2+ parameterizes. J5 is a genre-neutral judge — it
asks "is the world rule operational?" — that the planner can apply to
LitRPG (System rules), romance (social conventions), pulp (magic costs),
or mystery (procedural rules) by parameterizing what counts as a "world
fact." The judge prompt itself does not need genre-specific text.

### Granularity

Calibration anchor: scene-level, gated on at least one declared world
fact reference appearing in the plan or beat.

Production emit: same.

### Input shape

```json
{
  "sceneId": "ch-002-scene-001-arbiter-interview",
  "declaredWorldFacts": [
    "The System assigns stats and corrects misregistrations within days",
    "Arbiters investigate System anomalies",
    "Strength stat below 5 indicates physical frailty"
  ],
  "sceneProse": "<full scene prose verbatim>"
}
```

`declaredWorldFacts` is the small set of world-fact strings the plan
declared the scene should USE. The harness extracts these from the
chapter outline + planning-state-mapper `establishedFacts` filtered to
those marked relevant for this scene.

### Output shape

```json
{
  "label": "WPRESS-0" | "WPRESS-1" | "WPRESS-2" | "WPRESS-3",
  "operational_facts": ["<which declaredWorldFacts actually constrained action; verbatim from input>"],
  "decorative_facts": ["<which declaredWorldFacts were mentioned only as flavor>"],
  "evidence_quote": "<verbatim ≤30-word quote showing the most operational fact at work, or showing decorative use if WPRESS-0/1>",
  "abstain_reason": null | "<reason>"
}
```

Binary collapse: WPRESS-{0,1} = DECORATIVE, WPRESS-{2,3} = OPERATIONAL.

### Rubric

```
You are a single-dimension judge for whether world facts pressure the
scene.

You are given a scene's prose and a list of world facts the plan
declared the scene should use. World facts are rules, systems,
geographic constraints, political structures, magic costs, or social
conventions — anything that limits or shapes what characters can do.

Your job: for each declared world fact, classify it as OPERATIONAL or
DECORATIVE in this scene's prose.

OPERATIONAL means at least one of:
- the fact constrains a character's available actions (a character cannot
  do X because the fact forbids it)
- the fact creates a cost (a character does X but pays Y because the
  fact requires it)
- the fact alters an outcome (a character attempts X and the fact
  determines whether it succeeds)
- the fact forces a choice (a character must pick between options the
  fact has framed)

DECORATIVE means the fact is named or referenced but does not bite. The
scene would resolve the same way if the fact did not exist.

Then label the scene overall:

WPRESS-0: zero declared world facts are operational. All references are
flavor.

WPRESS-1: one declared world fact is operational, but only as
backstory/setup. The scene's central conflict does not turn on a world
rule.

WPRESS-2: at least one declared world fact is operational AND shapes the
scene's central conflict or decision. The scene works because of the
rule.

WPRESS-3: at least one declared world fact is operational AND its
operation creates a forward problem the protagonist must solve next. The
rule does not just shape this scene; it ratchets the pressure for the
next.

Use the LOWEST label whose evidence requirements are FULLY satisfied.

Quote ≤30 words verbatim showing the most operational fact at work, or
showing decorative use.

Do not score voice or quality. Only worldbuilding pressure.

Respond with ONLY valid JSON.
```

Polarity-bias mitigation: the per-fact OPERATIONAL/DECORATIVE
classification before the overall label prevents the judge from voting
"operational" because the scene felt world-y. The judge must point at a
specific fact doing specific work.

### Calibration plan

- Anchor set size: 24 known-answer cases. 8 WPRESS-0 (decorative
  world-mention scenes; LitRPG flavor without bite), 8 WPRESS-1
  (background world rule that doesn't shape the conflict), 6 WPRESS-2
  (rule shapes conflict), 2 WPRESS-3 (rule shapes + ratchets next).
  Drawn from existing `fantasy-system-heretic` chapters and authored
  synthetics.

- Granularity stability check: run on full scene vs. on scene's pivotal
  beat only. Both should agree on the operational/decorative
  classification of each fact at J ≥ 0.85. The beat-only run is the
  generalization test — if it diverges sharply, the judge is
  scene-level-only and we accept that constraint.

- Position-bias controls: 6 adversarial cases where the
  `declaredWorldFacts` list is enriched with 1-2 facts that DO NOT
  appear in the prose. The judge should not classify those as
  operational. If it does, the rubric is leaking from "this fact
  matters in worldbuilding" to "this fact matters in the scene."

- Failure mode: binary collapse to DECORATIVE/OPERATIONAL.

### Stop conditions

- `declaredWorldFacts` is empty: skip with `applicability_skip`. The
  scene has no declared world surface to evaluate.

- The scene is a pure-character / pure-relationship scene where world
  rules genuinely don't apply (e.g., two characters in a private
  conversation about their feelings): mark `applicability_skip` even if
  `declaredWorldFacts` is non-empty, because the judge will reliably
  emit WPRESS-0 and that is not a quality signal.

### Cost target

~800 prompt / ~120 output. ~$0.0014/call. N=20: ~$0.028.

---

## Judge J6: Promise/payoff clarity

### Purpose

The corpus extractors `structure-promise/promise-open-system.md` and
`promise-close-system.md` already model the promise concept. J6 is the
prose-layer analog applied to a SINGLE promise event: when the planner
declared a beat opens or pays off a promise, does the prose render it
LEGIBLY — meaning a non-genre-savvy reader can identify the promise
(opening) or feel the payoff (closing) without decoding genre tropes?

Two failure modes this catches:

1. Promise opens that are too quiet. The planner says "this beat opens
   the question of whether the protagonist's strength can stay hidden,"
   but the prose buries that question under setting description. A
   reader does not register a promise; they register atmosphere.

2. Payoffs that the writer has emitted but the prose obscures. The
   planner says "Cassel discovers the truth"; the prose has Cassel
   say something cryptic that, only with chapter-level context, can be
   inferred to mean discovery. A genre-savvy reader catches it; a
   commercial reader does not.

This is a commercial-readability judge. Romance, pulp, LitRPG, and
mystery all share the trait that promises and payoffs need to be
LEGIBLE within their genre's conventions. The genre-flexibility memory
applies — the judge prompt is genre-neutral; the planner declares which
beats are promise-opens and promise-closes per genre conventions.

### Granularity

Calibration anchor: beat-level. One promise event per call.

Production emit: same.

### Input shape

```json
{
  "beatId": "ch-008-beat-005-cassel-realization",
  "promiseId": "p007",
  "eventType": "open" | "close",
  "promiseText": "<≤200 char description from PromiseRegistry>",
  "beatProse": "<full beat prose verbatim, typically 250-450 words>",
  "priorBeatLastParagraph": "<last paragraph of preceding beat for transition context, or null if first beat>"
}
```

The judge sees the planner's declaration of what the promise is — but
must verify the prose makes it LEGIBLE without that declaration. We
test legibility by asking the judge to first attempt to identify the
promise event from prose alone, THEN compare to the declared.

### Output shape

```json
{
  "label": "PROMISE-0" | "PROMISE-1" | "PROMISE-2" | "PROMISE-3",
  "reader_inferable": true | false,
  "inferred_promise_text": "<what a reader would identify as the promise from the prose alone>",
  "evidence_quote": "<verbatim ≤30-word quote showing the promise/payoff moment>",
  "abstain_reason": null | "<reason>"
}
```

Binary collapse: PROMISE-{0,1} = ILLEGIBLE, PROMISE-{2,3} = LEGIBLE.

### Rubric

```
You are a single-dimension judge for promise/payoff legibility in a beat.

A promise is a setup that creates a reader expectation of future payoff
(a vow, a mystery, a goal, a threat, a relationship tension, a latent
capability). A payoff lands that expectation.

You are given a beat's prose, the prior beat's last paragraph for
transition context, and the planner's declaration of (a) what the
promise is and (b) whether this beat opens or closes it.

First, IGNORING the declared promise text, read the beat and identify
what promise event you observe. Write your inferred description of what
the prose appears to promise (for opens) or pay off (for closes).

Then, label legibility on this scale:

PROMISE-0: no promise event is identifiable from prose alone. The
declared promise/payoff is invisible. A reader would parse the beat as
flavor, atmosphere, or unrelated business.

PROMISE-1: a promise event is identifiable but only with genre-savvy
decoding. The reader senses something is being set up or paid off, but
cannot say what. Common in opens that hint without stating; common in
closes that resolve obliquely.

PROMISE-2: a promise event is identifiable from prose alone and the
reader's inferred description matches the declared promise/payoff in
direction. The reader knows what is being promised or paid.

PROMISE-3: PROMISE-2 PLUS the prose adds emotional or narrative weight
that makes the promise feel load-bearing. For opens: the beat plants the
promise with stakes the reader cares about. For closes: the payoff
feels earned (the reader registers the closure of an arc, not just the
delivery of a fact).

Use the LOWEST label whose evidence requirements are FULLY satisfied.

Set reader_inferable=true if PROMISE ≥ 2.

Quote ≤30 words verbatim showing the promise/payoff moment.

Do not score voice, prose quality, or whether the promise was a "good"
promise. Only legibility.

Respond with ONLY valid JSON.
```

Polarity-bias mitigation: the "infer first, then compare" structure
forces the judge to attempt reader-side inference before seeing the
declared text re-affirm. This is the same trick that makes blind
identity-assignment evals work in `salvatore-distinctness-v1` — separate
the model's own observation from the planner's claim.

### Calibration plan

- Anchor set size: 32 known-answer cases. 16 opens (8 illegible / 4
  legible / 4 weighted) and 16 closes (8 illegible / 4 legible / 4
  weighted). Sourced from PromiseRegistry-tagged corpus beats.

- Granularity stability check: also run a chapter-level variant in
  cases where the promise spans multiple beats. The chapter-level
  run should agree with the beat-level run on the binary
  legible/illegible label at J ≥ 0.85. Deviations indicate the judge
  needs more transition context (extend the input to include the
  surrounding 3 beats).

- Position-bias controls: 8 cases where the declared `promiseText`
  is intentionally mismatched with the prose (judge sees a true beat
  but a wrong declared promise). The `inferred_promise_text` field
  must NOT match the wrong declared text. If the model's inferred
  text drifts toward the declared text in these cases, the
  "infer-first" structure is failing.

- Failure mode: binary collapse to LEGIBLE/ILLEGIBLE.

### Stop conditions

- Beat is not declared as a promise-open or promise-close in the
  PromiseRegistry: skip. The judge has no event to evaluate.

- Promise spans more than 5 beats and this is a middle-progress beat:
  skip with `applicability_skip`. Progress beats are not in scope.

### Cost target

~900 prompt tokens / ~150 output tokens. Flash ~$0.0016/call. N=20
panel: ~$0.032.

---

## Judge J7: Prose commercial readability

### Purpose

This is the only judge in the set that operates at the
prose-mechanics layer rather than the structural layer. Its purpose is
narrow: catch chapters whose mechanics make them commercially
unreadable for the LitRPG / fantasy-adventure target audience.

The user's "Don't calibrate noisy LLM checkers" memory rules out
prose-quality scoring — and this judge is NOT a prose-quality judge.
It is a structural mechanics judge with deliberately narrow anchors:

- Sentence-length variation (boring uniformity is a flag).
- Dialogue ratio (long passages without dialogue in scenes that should
  have dialogue).
- Scene-end hook presence (per the writer prompt's hook contract).
- Paragraph length variation (wall-of-text is a flag).

These four anchors are checkable. The judge does NOT score "is this
good prose?" — it scores "does this prose have the structural mechanics
of commercial fantasy adventure?" against measurable anchors that
match the Salvatore corpus distribution.

The reason this isn't a regex job (per "Sparing Regex Scorer"
feedback): regex can count sentence lengths but cannot judge whether
a long passage without dialogue belongs there (interiority scenes
legitimately have low dialogue) or whether the chapter's last paragraph
functions as a hook (a regex can find the last paragraph; it cannot
judge whether the paragraph hooks).

### Granularity

Calibration anchor: chapter-level. The four mechanics anchors evaluate
a full chapter.

Production emit: same.

### Input shape

```json
{
  "chapterNumber": 1,
  "scenesPresent": ["ch-001-scene-001", "ch-001-scene-002", "ch-001-scene-003"],
  "chapterProse": "<full chapter prose verbatim>",
  "deterministicMetrics": {
    "wordCount": 2451,
    "sentenceCount": 187,
    "meanSentenceWords": 13.1,
    "sentenceWordsP10": 5,
    "sentenceWordsP90": 24,
    "dialogueLineCount": 22,
    "dialogueWordRatio": 0.18,
    "paragraphCount": 64,
    "meanParagraphWords": 38.3,
    "paragraphWordsP90": 95
  }
}
```

The deterministic metrics are pre-computed and passed in, NOT computed
by the judge. This is the "regex only for validated structural counts"
discipline — counts are deterministic; judgment about them is the LLM's
job.

### Output shape

```json
{
  "labels": {
    "sentence_variation": "PASS" | "FAIL",
    "dialogue_appropriateness": "PASS" | "FAIL",
    "hook_present": "PASS" | "FAIL",
    "paragraph_variation": "PASS" | "FAIL"
  },
  "overall": "READABLE" | "MARGINAL" | "UNREADABLE",
  "evidence": {
    "sentence_variation": "<≤30 word reasoning + quote, or null>",
    "dialogue_appropriateness": "<≤30 word reasoning + quote, or null>",
    "hook_present": "<verbatim ≤30 word quote of the closing 1-3 sentences>",
    "paragraph_variation": "<≤30 word reasoning + quote, or null>"
  },
  "abstain_reason": null | "<reason>"
}
```

The four sub-labels are independent binaries. The overall is derived:
4/4 PASS = READABLE; 3/4 PASS = MARGINAL; ≤2/4 PASS = UNREADABLE.

### Rubric

```
You are a structural mechanics judge for chapter prose readability in
commercial fantasy/adventure fiction.

You are given the full chapter prose and pre-computed deterministic
metrics (word count, sentence-length quartiles, dialogue ratio,
paragraph-length quartiles, scene boundaries).

You will judge FOUR independent binary mechanics:

1. SENTENCE VARIATION
PASS if: meanSentenceWords is between 10 and 22, AND p90/p10 ratio is
≥ 3.0 (the chapter mixes short and long), AND the prose does not have
a run of >6 consecutive sentences within ±2 words of the mean.
FAIL if: monotone sentence rhythm. Quote a 30-word stretch showing the
monotony.

2. DIALOGUE APPROPRIATENESS
For each scene with 2+ named characters present, the scene should
contain dialogue. Use scenesPresent and the prose to identify scenes
that should have dialogue but do not (continuous narration where two
characters interact without speech). PASS if: every multi-character
scene has dialogue lines. FAIL if: at least one multi-character scene
runs > 200 words of continuous narration without dialogue.
A solo scene legitimately has no dialogue; do not flag those.

3. HOOK PRESENCE
PASS if: the chapter's final 1-3 sentences enact an action consequence,
an interiority decision, or a forward-pulling fragment (a question the
protagonist now faces, a named threat now active, a choice not yet
made).
FAIL if: the chapter ends on description, reflection without forward
arrow, or summary. Quote the final sentence.

4. PARAGRAPH VARIATION
PASS if: the chapter contains at least one paragraph ≤ 15 words AND
at least one paragraph ≥ 50 words, AND the longest paragraph is ≤ 200
words.
FAIL if: monotone paragraph length OR a wall-of-text paragraph >200
words.

Then derive overall: 4/4 PASS = READABLE; 3/4 PASS = MARGINAL; ≤2/4
= UNREADABLE.

Do not score voice quality, prose elegance, or whether the chapter
"sounds like Salvatore." Only the four mechanics above.

Respond with ONLY valid JSON.
```

Polarity-bias mitigation: every label is binary and gated on
deterministic counts. The judge cannot drift on overall reading
preferences because the overall label is derived, not voted.

### Calibration plan

- Anchor set size: 24 known-answer chapter cases. 8 READABLE (Salvatore
  reference, Austen public-domain calibrated to similar mechanics
  band), 8 MARGINAL (corpus chapters with one known mechanics issue),
  8 UNREADABLE (existing wall-of-text generated chapters; the
  `fantasy-system-heretic` chapter-1 sample reads borderline-MARGINAL
  on dialogue ratio at 0.18 vs. Salvatore's 0.27 — useful calibration
  point).

- Granularity stability check: also run on 1500-word vs. 3000-word
  chapter slices. The judge should hit J ≥ 0.85 at both. Long
  chapters are the harder case — sentence-variation and hook detection
  scale fine, but dialogue-appropriateness needs the harness to pass
  in the per-scene character-count metadata cleanly.

- Position-bias controls: not applicable. Add 4 adversarial cases:
  same chapter, but the deterministic metrics are mutated to lie
  (e.g., real meanSentenceWords=13 reported as 18). The label
  derivations should follow the prose, not the metrics. If the judge
  blindly trusts wrong metrics, the rubric needs a "verify metrics
  against prose" addendum before promotion.

- Failure mode: drop the four-label decomposition; emit only the
  overall READABLE/MARGINAL/UNREADABLE label. If even that fails, the
  judge is too coarse for this surface and we route to operator
  review for chapters flagged on deterministic mechanics alone.

### Stop conditions

- Chapter < 800 words: skip. The mechanics rubric is calibrated for
  chapter-scale prose; flash fiction needs different anchors.

- Chapter is purely action (battle scene, chase): the
  dialogue-appropriateness label may legitimately FAIL. Flag for
  operator and emit the four sub-labels but do not derive overall.

### Cost target

~1200 prompt tokens (full chapter dominates) / ~200 output tokens.
Flash ~$0.0024/call. N=20 panel: ~$0.048. This is the most expensive
judge in the set; use sparingly and only after structural judges
clear.

---

## Optional judges (specified)

### Judge J8: Magic-system tension

- Granularity: scene with declared magic-action beat.
- Input: scene prose + declared magic action + declared cost.
- Output: MAGIC-0..3. 0=no cost shown; 1=cost named not enacted;
  2=cost enacted; 3=cost enacted AND constrains subsequent action.
- Calibration: 20 cases. Cost ~$0.001/call.

### Judge J9: Want vs need legibility

- Granularity: chapter.
- Input: chapter prose + LTWN `want` and `need`.
- Output: WN-0..3. 0=neither legible; 1=want only; 2=both legible
  no tension; 3=both legible AND tension on page.
- Calibration: 20 cases. Cost ~$0.002/call. Run every N chapters,
  not every chapter.

(Mystery clue economy not specified — current target genre doesn't
justify it.)

---

# PART B — Prompt Structure Critique

## Prompt: planning-plotter / chapter-outline-system.md

### Current contract

The chapter-outline planner produces a flat list of chapter skeletons
(number, title, POV, setting, purpose, target words, characters
present) from a world bible, character profiles, and story spine. It
explicitly defers beat-level detail to a downstream pass. It enforces
six structural rules (STASIS=DEATH opening, midpoint reversal, pinch
points, whiff of death, try/fail cycles, forward hooks) and forbids
ending chapters on pure description.

### Failure modes observed

1. The v0 method-pack cohort showed that this planner saturates at
   ENDPOINT-2 / AGENCY-2 across both control and method arms
   (`planner-discernment-real-data-v0.md`). The chapters ARE planned
   and ARE structurally functional. They are not RICH. That is a
   ceiling problem, not a brokenness problem — but the prompt is
   complicit because its structural rules are checklist items, not
   pressure-creating constraints.

2. The "STASIS = DEATH" requirement on the opening chapter primes
   the model to write opening-scene archetypes (the gilded cage
   moment, the false peace) that look identical across novels. The
   `fantasy-system-heretic` chapter 1 — eight years of hidden
   strength, anxious morning ritual, knock at the door — is a clean
   STASIS=DEATH execution that nonetheless reads as a stock opening
   because the rule was satisfied at the cost of specificity.

3. The "WHIFF OF DEATH" requirement uses dramatic terminology
   ("significant irreversible loss") without anchoring what KIND of
   loss matters. The model defaults to the safest interpretations
   (death of a relationship, destruction of a key resource) — which
   are listed as examples in the prompt itself. Listing the safe
   interpretations primes the safe interpretations.

### Where the prompt adds noise

- Lines 28-35 enumerate six structural rules in a flat bulleted list
  with no priority weighting. The model treats them as a 6-item
  checklist to satisfy, which makes the OUTPUT a 6-item satisfaction
  artifact rather than a story. This is the same failure mode as the
  v0 method-pack arm: structural slot fit at 100% with no character/
  world / endpoint lift.

- Line 35 ("NEVER close a chapter on pure description") is hyper-
  specific within an otherwise high-level prompt. Including it here
  forces the planner to think about prose mechanics during chapter
  skeleton generation — a downstream concern that should live in the
  beat-expansion or writer prompts. It primes the planner to
  pre-emit endpoint-shaped purpose strings that LOOK like hooks but
  read identically across novels.

### Where the prompt overconstrains

- "TRY/FAIL CYCLES: at least 2-3 distinct attempts" is a per-chapter
  prescription that conflicts with multi-chapter try-fail arcs. A
  novel can have 2-3 try/fail cycles total spread across 12 chapters;
  the prompt reads as 2-3 attempts per chapter, which the planner
  satisfies by emitting micro-attempts inside chapter `purpose`
  strings. This is a likely contributor to the AGENCY-1 saturation
  (lots of small attempts, none load-bearing).

- The `targetWords` ranges (800-1500 short, 1500-3000 long) plus
  "pick per chapter based on its dramatic weight" are doing two jobs
  with one parameter. Drama weight should select chapter complexity;
  word count should be a downstream estimate. Asking the planner to
  conflate them produces over-flat word distributions in real
  outputs.

### Where the prompt fails to preserve story quality

- No requirement that each chapter advance a NAMED structural thread
  (MICE thread, promise, value-charge axis). The corpus extractors
  produce these tags; the planner should consume them as inputs and
  emit chapters that explicitly reference which thread they are
  moving. This would push the planner from "every chapter must
  advance the plot AND develop at least one character" (vague) to
  "every chapter declares which thread it opens / progresses /
  closes" (auditable).

- No CONTRAINDICATION rules. The prompt tells the planner what to
  do but never what NOT to do at the chapter level. A
  contraindication like "do not propose two consecutive C-thread
  internal-revelation chapters" or "do not pay off a promise in the
  same chapter it was opened" would let the planner build
  variation.

### Proposed before/after edit

Original line 28-35:

```
Structural requirements across the whole arc:
- STASIS = DEATH: the opening chapter must establish why the protagonist's current situation is unsustainable.
- MIDPOINT REVERSAL: around the midpoint, a False Victory or False Defeat — a sharp tonal reversal, not a gradual shift.
- PINCH POINTS: at least two moments where the antagonistic force demonstrates power or raises stakes.
- WHIFF OF DEATH: before the final act, a significant irreversible loss — death of a relationship, destruction of a key resource, loss of a primary belief or ally.
- TRY/FAIL CYCLES: the protagonist's main goal must involve at least 2-3 distinct attempts that each escalate stakes. Reflect these in chapter purposes.
- End each non-final chapter's `purpose` with a forward hook — something unresolved that pulls the reader into the next chapter.
- **NEVER close a chapter on pure description.** Chapter closes should land on action consequence or interiority decision — a beat the reader can feel as resolution or hook, not a static descriptive image of the setting. When `purpose` text leans into a chapter's close, frame it as either an action consequence or an interiority decision.
```

Proposed replacement:

```
Structural requirements across the whole arc:

The arc must move on at least one MICE thread (Milieu, Idea/Inquiry,
Character, Event) opened in the first three chapters and closed in the
last three. Name the dominant thread in each chapter's `purpose` text
using one of those four words. A single thread may dominate the whole
novel, but every chapter's purpose must declare its thread role:
"opens", "progresses", or "closes".

The opening chapter must establish a specific local pressure that the
protagonist cannot ignore. Do not state "the protagonist's situation
is unsustainable" abstractly; the opening must name what changes today
that did not change yesterday. If the situation has been unsustainable
for years (a hidden identity, a chronic threat), the opening chapter
must name the proximate event that reopens it.

Between chapter 1 and the final third, plan 2-3 escalating attempts at
the protagonist's main external goal across the WHOLE ARC, not within
each chapter. Each attempt's chapter must declare in its `purpose`
which numbered attempt it is and what cost the previous attempt's
failure imposed.

A midpoint chapter (50% ± 10%) must reverse the protagonist's tonal
position: false victory turning toward inevitable defeat, or false
defeat turning toward forced ascent. State the reversal in the
chapter's `purpose`.

Before the final third, plan a chapter where the protagonist loses
something they cannot recover and that the reader has been shown to
care about. Name what is lost. Do not default to "death of a
relationship" or "destruction of a key resource" unless the prior
chapters have made that specific relationship or resource load-bearing.

Each chapter's `purpose` should end with a sentence fragment that
states what the protagonist must now decide, attempt, or avoid in the
next chapter. This fragment is the hook for the downstream
beat-expansion stage. Do not over-specify HOW the chapter will close
in prose; the writer plans that.

Contraindications:
- Do not place two consecutive chapters in the same MICE thread role
  (two consecutive "opens" or two consecutive "closes" without a
  "progresses" between).
- Do not pay off a promise in the same chapter it was opened unless
  the chapter is explicitly a self-contained one-chapter arc.
- Do not give the protagonist the same external goal in every chapter.
  Goals shift as the situation pressures them.
```

This rewrite removes the per-chapter prose-mechanics rule (line 35)
which doesn't belong in a planner prompt, replaces the flat checklist
with thread-typed structural roles that connect to the corpus
extractors' output, and adds three contraindications that prevent the
known saturation modes.

### Test plan

- A/B 12 chapter outlines (6 control, 6 new prompt) on the existing
  v0 cohort fixtures using the planner-discernment-real-data harness.
  Run J1 (endpoint landing, prose) downstream on draft chapters and
  compare endpoint-landing distribution. Cost: ~$0.40 for 12 plans
  + ~$0.30 for 6 generated chapters per arm + ~$0.05 for J1 panel.
  Total under $1.50.
- Stop gate: new prompt must show ≥ 1 absolute level shift in
  ENDPOINT median or AGENCY median across the 6 cells, with no cell
  regressing more than 1 level. If neither dimension lifts, the
  prompt is not the bottleneck — the model is.
- Pre-registration: declare the gate above before the run; record in
  a lane doc.

---

## Prompt: planning-beats / beat-expansion-system.md

### Current contract

Beat-expansion takes one chapter skeleton and emits its dramatic beat
sequence. It is BEAT SHAPE ONLY (no chapter state / knowledge /
obligations / payoffs). The schema includes optional soft-prior fields
(`valueShifted`, `gapPresent`, `lifeValueAxes`, `miceActive`/`Opens`/
`Closes`). It enforces beat-count formulas, beat description discipline
(1-2 sentences, no dialogue, no quoted speech), and structural guidance
(open with action, close with action/interiority).

### Failure modes observed

1. The 100%-saturation finding on `worldPressure`, `endpointLanding`,
   `causalMomentum`, `promiseProgress`, `sceneDramaturgy` at level 2
   (`planner-discernment-real-data-v0`) is partially attributable to
   this prompt: it produces beats that satisfy the existence checks
   but rarely escalate. The "Each beat description must be 1-2
   sentences" rule (line 29) is a primary cause — short descriptions
   force the planner toward summary verbs ("confronts", "discovers",
   "decides") that paper over what specifically is at stake.

2. The "Beat descriptions must never contain dialogue" rule (line 31)
   is sound (it prevents the planner from drafting prose), but the
   examples (line 33-36) leave the model under-anchored on what TO
   put in beat descriptions. "Kael discovers Davan's betrayal
   through a hidden letter -- physical evidence that rewrites her
   belief in the order's loyalty" is a good example, but the next
   beat in real outputs typically shrinks back to "Kael confronts
   Davan about the betrayal" — verb-only, no specific stake.

3. The soft-prior fields (line 50-58) are optional AND "Downstream
   checkers must not block on these fields" (line 52). This makes
   them advisory metadata that gets ignored at writer time. The
   `valueShifted` field IS the per-beat polarity decision that
   value-charge corpus extraction tags after the fact; making it
   optional and non-blocking guarantees it is mostly omitted.

### Where the prompt adds noise

- The "Beat count formula" (line 27) gives THREE different formulas
  with hard floors and recommended counts and don't-exceed-by-more-
  than-1 rules. The model treats this as a quantitative target and
  emits beat counts to formula. This is a feature when chapters
  have natural beat counts that match the formula and a bug when a
  chapter naturally has a different shape (a single confrontation
  scene that needs 8 beats; a transitional chapter that wants 2).

- "Maximum 3 named characters actively speaking or acting per beat"
  (line 45) is a writer-prose-mechanics rule embedded in the
  planner. The beat planner's job is to decide what changes
  dramatically, not to manage the writer's roster.

### Where the prompt overconstrains

- "Each beat description must be 1-2 sentences. Longer descriptions
  constrain the writer's creative latitude and reduce dialogue in
  the output" (line 29) is doing two contradictory things: it
  constrains description length (good — keeps planner abstract) and
  it claims the constraint helps the writer (debatable — short
  descriptions force the writer to invent the dramatic specifics
  the planner could have specified). The "creative latitude"
  framing is also a strategic mistake — Salvatore-quality scenes
  come from specific dramatic specification, not from writer
  latitude.

- "Open with action or description. Do not open with interiority
  unless the POV character is alone" (line 43) constrains beat
  openings without justification. Many strong scenes open with
  interiority that triggers immediate action. Adding the
  "unless... alone" exception primes the model to either gate
  interiority opens behind solo scenes or to skip them.

### Where the prompt fails to preserve story quality

- No requirement that consecutive beats CHANGE the dominant value
  axis or progress a thread. The current prompt has structural
  guidance ("Sustain sequences", "Two consecutive description beats
  is stasis") but doesn't require thread-typed beat continuity.
  The corpus reference shows scenes with median 5 beats and clear
  per-scene polarity arcs; the planner can produce the right beat
  count with a flat polarity profile.

- The beat description CONTRACT does not require the beat to name
  the SPECIFIC pressure the POV character feels in this beat. The
  generic "X discovers Y" pattern is the result. Asking for
  pressure makes the beat description load-bearing for the writer.

### Proposed before/after edit

Original line 24-31:

```
## Beat Discipline

One beat is one dramatic moment, not one full scene and not one micro-action. The current writer usually expands one planned beat into about 300-450 words of prose. A chapter with a 1200-word target usually needs 3-4 beats. A chapter with a 1500-word target usually needs 4-5 beats. Do not over-fragment beats.

Beat count formula: at minimum, `ceil(targetWords / 400)` beats with a hard floor of 3. Recommended count is about `ceil(targetWords / 325)`. A 1200-word chapter needs at minimum 3 beats; a 1500-word chapter needs at minimum 4; a 2000-word chapter needs at minimum 5. Do not exceed the recommended count by more than 1 unless the chapter has multiple distinct set pieces.

Each beat description must be 1-2 sentences. Longer descriptions constrain the writer's creative latitude and reduce dialogue in the output.

Beat descriptions must never contain dialogue. No quoted speech, no "he says," no "she replies." Describe what characters confront, reveal, or demand, not the words they speak.
```

Proposed replacement:

```
## Beat Discipline

One beat is one dramatic moment — one shift in attention, one
exchange, or one action sequence. The writer typically renders one
planned beat as 300-450 words of prose, but the planner does not
manage word count. The planner specifies what changes; the writer
specifies how it reads.

Beat count: aim for ceil(targetWords / 350) beats. The writer can
expand or compress within ±20% of the planned beats based on
dramatic weight. A 1200-word chapter typically lands at 3-4 beats;
a 1500-word chapter at 4-5; a 3000-word chapter at 8-10. Chapters
with a single dominant set piece (a long confrontation, a
multi-stage chase) may legitimately have 6+ beats on a 1200-word
target — the writer compresses each beat. Chapters that are
transitional or interior may legitimately have 2-3 beats on a
2000-word target.

Each beat description is 2-3 sentences and must contain three
elements:

1. The POV character's GOING-IN expectation or intention.
2. The pressure or opposition the beat applies.
3. The specific change of state by beat exit (a fact established,
   knowledge acquired, relationship axis moved, value polarity
   flipped, or position lost/gained).

Beat descriptions must never contain dialogue, quoted speech, or
"he says" / "she replies." Describe the dramatic transaction; do
not script its words.

Bad: "Kael discovers Davan's betrayal."
Bad: "Kael says, 'I won't forgive you.'"
Good: "Kael, expecting routine archive duty, finds in the third
folio a letter in Davan's hand — physical evidence that her mentor
has been laundering the order's records. By beat exit, her belief
in the order's loyalty has been replaced by a question she cannot
yet name."

If a character must perform a specific verbal action (refuse,
demand, reveal, accept), state it directly: "Kael refuses Davan's
explanation despite his concrete justification, exiting the
archive without a stated next move." Do not bury load-bearing
verbal action in vague phrasing like "discusses" or "considers."
```

This rewrite expands beat descriptions from 1-2 to 2-3 sentences (the
extra sentence is the going-in expectation, which is what
`structure-mckee-gap` corpus-tags after the fact), names the three
required elements explicitly (going-in expectation, pressure,
change-of-state), and removes the "creative latitude" framing that
incentivizes thin descriptions.

### Test plan

- A/B 6 chapter beat-expansions (3 control, 3 new prompt). Run J2
  (scene dramatic completeness) + J3 (character agency) on the
  downstream-drafted scenes. Same fixtures as the v0 real-data
  cohort. Cost: ~$0.20 plans + ~$0.40 drafts + ~$0.04 judges = ~$0.65.
- Stop gate: SCENE-2/3 rate must lift ≥ 15 percentage points or
  AGENCY-2/3 rate must lift ≥ 15 percentage points; if neither, the
  beat description shape is not the bottleneck.

---

## Prompt: writer / prose-writer-system.md

### Current contract

The full-chapter writer takes scene beats + context and emits the full
chapter prose as a single JSON `prose` field. It enforces 5+ pages of
craft rules — character voice, scene structure (GOAL → CONFLICT →
DISASTER + sequel), filter words, named-emotion bans, AI-cliché
blocklist, environment-as-emotional-mirror guidance, and showing-vs-
telling rules.

### Failure modes observed

1. The chapter samples from `fantasy-system-heretic` show a writer
   that obeys most micro-rules but produces wall-of-text paragraphs
   and a mean dialogue ratio (0.18 in chapter 1) below the
   Salvatore reference distribution (0.27). The writer is following
   the rules and still producing something that reads less
   commercially than the corpus target. The rules don't add up to
   the target voice.

2. The "AI-fiction clichés" blocklist (line 45-55) is the kind of
   prompt that the user's "A/B priming-suppression before
   shipping" memory specifically warned about. Listing "let out a
   breath she didn't know she'd been holding" as a forbidden phrase
   primes the model to think about it. The 2026-04-20 Salvatore
   blocklist removal A/B doubled absolute fire rate when the
   blocklist was removed — meaning blocklist removal HURT, but the
   point of that lesson was to A/B real-panel before assuming the
   blocklist works as intended. We don't have a paneled A/B for
   this writer's blocklist as far as the docs show.

3. The scene-structure rule (line 15) "GOAL → CONFLICT → DISASTER"
   plus REACTION → DILEMMA → DECISION sequel template is a Swain-
   model prescription. The writer follows it visibly — the
   `fantasy-system-heretic` chapter 2 reads as a clean
   GOAL-CONFLICT-DISASTER scene. The problem is that EVERY scene
   reads as a clean GOAL-CONFLICT-DISASTER scene, which produces
   the rhythmic uniformity that J7 (sentence/paragraph variation)
   would catch.

### Where the prompt adds noise

- The 60+ line prompt is doing four jobs in one document: voice
  specification (line 17-25), scene structure (line 14-15), craft
  rules (line 27-60), telling-vs-showing exceptions (line 62-67),
  and environmental atmosphere (line 69-74). Each section is
  reasonable; the aggregate is a checklist the model satisfies
  feature-by-feature. The chapter that emerges is checklist-
  shaped.

- Lines 38, 44, 45, 56-60 are all "NEVER X" rules with specific
  forbidden tokens. As priming this is risky per the user's
  feedback. The redundant-body-parts rule ("nodded his head") is
  fine because the forbidden phrase is also forbidden in real
  prose. The cliché blocklist is risky because the model has to
  hold each cliché in context to avoid emitting it.

### Where the prompt overconstrains

- "Every scene must contain at least 2 exchanges of spoken
  dialogue" (line 37) is enforced by the prompt across all
  scenes. Solo scenes, interiority scenes, and pure-description
  scenes (rare but legitimate) are all rule-violated by this. The
  writer satisfies the rule by inventing dialogue that doesn't
  belong.

- "Anchor every paragraph in at least one sensory detail" (line
  40) plus the AI-cliché blocklist plus the show-don't-tell rules
  combine to drive the writer toward a high-density sensory-
  paragraph style that doesn't match the Salvatore reference's
  variation. Salvatore reference shows passages with one paragraph
  of pure dialogue, no sensory detail, between sensory-rich
  paragraphs. The prompt forbids that.

### Where the prompt fails to preserve story quality

- No requirement that the chapter's beat sequence be RECOGNIZABLE
  as a beat sequence. The writer is told "every beat must appear
  in the prose" (line 9) but not that beats must be locatable as
  scene units. The result is beats that blur into each other.

- No instruction to MATCH the dialogue ratio of the target genre.
  Salvatore's dialogue ratio (~0.27) is a learned distribution;
  asking the writer for "at least 2 exchanges" sets a floor that
  underperforms the target distribution.

### Proposed before/after edit

Trying to redesign the entire writer prompt is out of scope. The
highest-leverage edit is to remove the cliché blocklist and replace
it with a positive constraint. Original line 45-55:

```
- NEVER use AI-fiction clichés — these are the most recognized markers of machine-generated prose:
  - "the weight of [silence/guilt/etc.]" — show the physical sensation instead
  - "the silence stretched/hung/settled/thickened" — show what fills the silence: a clock, breathing, a fidgeting hand
  - "something shifted in/between" — name the specific change
  - "a flicker of [emotion]" — show the micro-expression: a tightened jaw, a quick glance away
  - "the air between them charged/thickened" — show tension through character action
  - "the world fell away/narrowed/faded" — narrow the sensory channel instead of announcing it
  - "couldn't quite place/name the feeling" — describe the confusion through action or contradictory impulses
  - "let out a breath she didn't know she'd been holding" — the single most flagged AI cliche. Show tension release through shoulders dropping, fingers unclenching.
  - "a shiver down her spine" — show goosebumps, a flinch, awareness of exits
  - "there was something about him/her" — name the specific detail that creates the effect
```

Proposed replacement:

```
- When you would describe an internal state, point at one specific
  physical thing instead. The body, the room, the small object in
  the character's hand. Be specific to this character and this
  setting — never reach for "silence" or "weight" or "shifted" or
  "flicker" as a noun for the unnamed.
```

This drops the priming list (the user's 2026-04-20 lesson), keeps
the positive directive (point at a specific thing), and explicitly
calls out the abstract-noun pattern without enumerating it. A
deterministic post-prose lint pass can flag the specific clichés
on the way out — that is the "regex only for validated structural
counts" path. The prompt should not enumerate forbidden tokens that
the model is supposed to avoid emitting.

### Test plan

- A/B 6 chapters (3 control, 3 new prompt) on the existing v0
  cohort. Run a deterministic cliché-detector AND J7 (mechanics
  readability). Cost: ~$0.50 generation + ~$0.05 judges.
- Stop gate: cliché-fire rate must NOT increase >5 absolute pp,
  AND J7 readability rate must NOT decrease. The hypothesis is
  that the positive directive is at least neutral on cliché
  fire and improves variation; if cliché fire jumps, the prompt
  removed the priming was actually load-bearing and we restore.

---

## Prompt: writer / beat-writer-system.md

### Current contract

The beat writer takes one beat brief plus context and emits prose for
that beat only. Shorter than the chapter writer prompt, focused on:
beat dramatization, GOAL/CONFLICT/DISASTER structure, speech-pattern
adherence, sensory anchoring, transition-bridge / landing-target
mechanics, allowed-new-entities, verbal-action enactment,
reader-info-state binding, and same-chapter physical-state continuity.

### Failure modes observed

1. The transition-bridge instruction ("NEVER repeat or echo
   dialogue, phrases, or imagery from the bridge") works as
   intended but the writer often interprets "do not repeat" as
   "change subject" — which kills the scene's continuity. The next
   beat starts a new emotional moment when the prior beat's
   emotional moment was the entire point.

2. The "Each beat must introduce NEW action, dialogue, and detail.
   Do not recycle lines or motifs from previous beats" (line 17)
   actively conflicts with continuity. Recurring motifs (the
   stretching silence between two characters, the smell of the
   archive, the trembling hands) are how short scenes build
   tension. The rule reads as anti-recycling but functions as
   anti-thematic-continuity.

3. The verbal-action enactment rule (line 19) is good and the
   reader-info-state binding (line 20) is necessary. The
   physical-state continuity rule (line 21) is the right kind of
   rule. None of these are the problem.

### Where the prompt adds noise

- The "approximately the target word count" instruction (line 7)
  plus the GOAL → CONFLICT → DISASTER per-beat structure (line
  8) push every beat to land a mini-arc. The result is that beats
  that should be quiet (reaction beats, sequels in the
  REACTION/DILEMMA/DECISION sense) get inflated into mini-scenes.
  The chapter-level writer's sequel-compression rule ("Sequels can
  be a single sentence") is missing here.

### Where the prompt overconstrains

- "Each beat must introduce NEW action, dialogue, and detail" is
  too strong. Reaction beats SHOULD echo the prior beat's emotional
  weight; revelations SHOULD reframe earlier details. The rule
  prevents the writer from doing what good fiction does.

### Where the prompt fails to preserve story quality

- No instruction on beat OPENING shape. The transition-bridge
  rule prevents echoing, but doesn't say what TO do with the
  opening. The writer often opens with a sentence that breaks
  POV or breaks tension because the rule pushed the obvious
  continuation off the page.

- No instruction on SUBTEXT. The chapter writer's prompt has
  good subtext guidance; the beat writer doesn't. Beat-shaped
  scenes need subtext most.

### Proposed before/after edit

Original line 17:

```
- Each beat must introduce NEW action, dialogue, and detail. Do not recycle lines or motifs from previous beats.
```

Proposed replacement:

```
- Each beat must move forward. Introduce new action, dialogue, or
  revelation that the prior beat did not contain. Recurring
  imagery and thematic motifs are allowed and expected — a
  motif (the smell of the archive, the dwarf's pipe smoke, the
  way two characters avoid eye contact) carrying through beats
  is craft, not recycling. What is forbidden is repeating the
  prior beat's specific dramatic content (the same exchange, the
  same insight, the same physical action) as if it had not
  happened.
```

This keeps the no-repetition discipline while explicitly licensing
motif and thematic continuity. The risk it adds is over-licensing
— the writer might lean into recurring motifs and produce purple
prose. The deterministic repetition detector
(`detectRepetition` in `src/lint/quality-detectors.ts`) catches
verbatim phrase repetition and is the right backstop.

### Test plan

- A/B 12 beats from 2 chapters (6 control, 6 new prompt). Run
  `detectRepetition` AND a Sonnet subagent qualitative review on
  motif vs. recycling. Cost: ~$0.40.
- Stop gate: `detectRepetition` fire rate must not increase
  >2 pp; Sonnet review must rate motif use as "earned" on at
  least 4/6 new-prompt beats. If both clear, the new prompt is
  net-positive.

---

## Prompt: writer / beat-writer-system-salvatore.md

### Current contract

This is the beat-writer-system prompt with a Salvatore-specific style
header and a proper-noun blocklist. It targets action-pulp fantasy
voice with explicit don't-name-Drizzt-or-Bryn-Shander discipline.

### Failure modes observed

1. The blocklist (line 22-27) is the largest source of priming
   risk in the harness. It enumerates 30+ proper nouns that are
   not to be used. Per the 2026-04-20 lesson, this kind of
   blocklist DOUBLED the fire rate when it was removed, which
   means it was load-bearing — but the point of the lesson was
   that priming-suppression behavior is not predictable in
   either direction without an A/B. We have one data point
   (removal hurts); we don't know whether the current blocklist
   is at the optimum or whether a smaller / restructured
   blocklist would do better.

2. The "Style targets" (line 3-9) read as descriptive, not
   prescriptive. "Sentence length averages ~18 words but varies"
   is a measurement; without a paneled writer that has been
   evaluated against the corpus distribution, this is a wish.
   The writer hits the 18-word average by averaging short and
   long, but the *variation* (p10 / p90 spread) is rarely
   actually achieved.

### Where the prompt adds noise

- The transition-bridge rule (line 13) is repeated from the
  beat-writer-system parent. Its repetition here primes the model
  to treat the bridge with double weight. The Salvatore-specific
  prompt should inherit, not duplicate.

- Listed character names in the blocklist that the writer would
  never plausibly emit (e.g., "Heafstaag", "Biggrin") add tokens
  without reducing risk. The blocklist could be pruned to high-
  risk names (Drizzt, Bruenor, Wulfgar, Catti-brie, Crystal Shard,
  Icewind Dale, Mithril Hall) without measurable loss.

### Where the prompt overconstrains

- "Sensory grounding in sight, sound, touch — cold, wind,
  firelight, steel" (line 7) is a content prescription, not a
  voice prescription. It primes the writer toward Icewind Dale-
  shaped imagery. The voice the corpus actually carries is
  PHYSICAL grounding (cold, wind, firelight, steel are the
  Salvatore-specific physical anchors); a more general writer
  voice prompt would say "physical anchors specific to the
  setting."

### Where the prompt fails to preserve story quality

- No instruction on the corpus-specific dialogue rhythm. The
  Salvatore corpus has a recognizable interrogative back-and-
  forth pattern (one character asks; one character partly
  answers; the asker reframes; the answerer concedes
  reluctantly). The prompt does not surface this pattern. The
  writer produces dialogue but not in that rhythm.

### Proposed before/after edit

Original line 22-29:

```
Proper-noun and world-element blocklist — NEVER use these unless the brief explicitly names them. They belong to other novels in the training corpus, not this one:
- Characters: Drizzt, Bruenor, Wulfgar, Regis, Catti-brie, Artemis Entreri, Jarlaxle, Zaknafein, Guenhwyvar, Akar Kessell, Dendybar, Sydney, Alustriel, Malchor Harpell, Pook, LaValle, Deudermont, Heafstaag, Cassius, Kemp, Revjak, Jensin Brent, Glensather, Biggrin
- World elements: drow, dark elves, Underdark, Forgotten Realms, Faerûn, Sword Coast, Silver Marches, the Realms
- Places: Icewind Dale, Ten-Towns, Mithril Hall, Lonelywood, Bryn Shander, Targos, Caer-Konig, Caer-Dineval, Termalaine, Easthaven, Dougan's Hole, Good Mead, Calimport, Silverymoon, Longsaddle, Mirabar, Sundabar, Luskan
- Items and artifacts: Crystal Shard, Crenshinibon, Aegis-fang, Twinkle, Icingdeath, Taulmaril, Heartstealer
- Races/creatures: duergar, svirfneblin, verbeeg

Use the character names, place names, and terminology that the brief provides. Do not substitute names from the blocklist even when the characters seem similar in archetype. If the brief names a halfling thief, call him what the brief calls him — not Regis. If it names a dwarven smith, not Bruenor.
```

Proposed replacement (with explicit pre-shipping A/B caveat):

```
Use the character names, place names, terminology, and proper nouns
that the brief provides. Do not introduce other proper nouns in this
beat unless they appear in the brief or in the "Allowed-new-entities"
line. This prohibition is structural, not stylistic — proper-noun
correctness is a continuity requirement, not a voice choice.
```

This is a HARD CHANGE and per the 2026-04-20 lesson it MUST be
A/B-tested before shipping. The rationale: the current blocklist is
~280 tokens of priming material. Replacing it with a positive
"use what the brief provides" rule removes the priming surface but
relies on the writer to apply general proper-noun discipline. The
risk is that without the named blocklist, the writer reaches for
Drizzt / Bruenor by reflex when the brief names a similar archetype.
A deterministic post-prose check against the blocklist (which can
remain in code, not in the prompt) catches the failure mode without
priming.

### Test plan

- A/B 16 beats (8 control, 8 no-blocklist) on the existing
  Salvatore distinctness fixture beats (the 4 archetypes × 6
  characters × ... structure from `salvatore-distinctness-v1`).
  Run a deterministic blocklist check on output AND human review
  for general voice quality.
- Stop gate: blocklist-violation rate must increase by NO MORE
  than +2 pp on absolute (current rate is near-zero per
  conditioning-floor results). If the rate jumps, restore the
  blocklist; if it holds, the priming was net-zero or negative
  and the new prompt ships.
- IMPORTANT: this is the highest-risk single edit in this
  document. Do not promote without a paneled A/B per
  `feedback_priming_suppression_ab.md`.

---

## Prompt: structure-promise / promise-open-system.md and promise-close-system.md

### Current contract

These are corpus-extraction prompts used to populate the
PromiseRegistry from published novels. They emit promise rows
(open pass) and closure rows (close pass) with confidence-calibrated
fields. They are NOT runtime prompts — they shape the structural
training data.

### Failure modes observed

1. The open-pass rule "Aim for completeness. Recall is the primary
   cost-function" (line 50) optimizes for high-recall extraction.
   Combined with the confidence ≥ 0.4 emission floor (line 49),
   this pushes the registry toward over-tagging. The downstream
   PromiseRegistry has many low-confidence promises that the
   planner consumes as if equally weighted.

2. The close-pass "EVERY input promise gets a closure entry —
   never drop one" (line 37) plus the open-at-end-of-book
   default-to-unsatisfied rule means the registry over-attributes
   "unsatisfied" to promises that are simply ongoing (series
   threads). This shows up downstream as planner-visible "broken"
   promises that aren't broken.

### Where the prompts overconstrain

- The open-pass requires `evidence_quote_open` to be a verbatim
  substring of the opening-beat summary (line 44). This is a sound
  discipline but it forces the model to drop high-confidence
  inferable promises that don't have a quotable summary line. The
  resulting registry is biased toward EXPLICIT promises (vows,
  declared mysteries) over IMPLICIT ones (latent tensions, slow-
  building threats).

### Where the prompts fail to preserve story quality

- The open-pass schema does not capture the AUDIENCE-FACING form
  of the promise. A vow ("I will find Catti-brie") is the same
  schema row as a latent tension ("Bruenor and Wulfgar's
  unresolved trust"), but they have different reader contracts.
  The planner downstream cannot distinguish them.

- The close-pass `payoff_quality` enum collapses
  "satisfied/partially_satisfied/unsatisfied/unclear" but does
  not capture WHEN the payoff lands. A promise paid off at 90%
  through the book (load-bearing climax) is qualitatively
  different from one paid off at 30% (early resolution that
  releases tension prematurely).

### Proposed before/after edit

For promise-open-system.md, original line 50:

```
7. **Aim for completeness.** Recall is the primary cost-function for this extractor (per the charter): missing a real promise is worse than emitting a borderline one. Err on the side of including a promise at confidence 0.5 rather than dropping it.
```

Proposed replacement:

```
7. **Recall is the primary cost-function, but not at any cost.**
   Missing a real promise is worse than emitting a borderline one,
   so err toward inclusion at confidence 0.5. However, if the
   "promise" is actually atmospheric framing or generic genre cue
   (a stormy first chapter, a violent prologue, the protagonist's
   default melancholy), do not emit. The downstream planner reads
   this registry as a contract; ghost promises become ghost
   payoff demands.
```

For promise-close-system.md, add a new field to the schema:

```
"payoff_position": "early" | "midpoint" | "late" | "climax" | "open"
```

Where:
- `early`: closed in first 33% of the book
- `midpoint`: closed 33-67%
- `late`: closed 67-90%
- `climax`: closed in final 10%
- `open`: open at end-of-book

This gives the planner a position signal it currently lacks. The
planner can then enforce contraindications like "no promise opens
in chapter 1 close in chapter 3" (premature payoff).

### Test plan

- Re-run the open-pass extractor on 2 corpus novels (Salvatore
  Crystal Shard, plus one public-domain novel for sanity) with
  the new instruction. Compare the registry size + low-confidence
  rate. Cost: ~$0.20 per novel.
- Stop gate: low-confidence (< 0.6) emission rate must drop by
  ≥ 20 percent without the recall on operator-known promises
  dropping more than 5 percent. Operator review on the
  subtractions (which promises did the new instruction drop?)
  decides whether the rule shipped or rolled back.

---

## Prompt: structure-value-charge / value-charge-system.md

### Current contract

This corpus extractor tags scenes with a single value axis, valueIn,
valueOut, polarity, and an evidence quote. Used to populate the
value-charge field downstream.

### Failure modes observed

1. The "ONE life value per scene — pick the dominant axis" rule
   (line 65) collapses scenes that genuinely move on two axes. A
   confrontation scene where Maret refuses to confess (truth-lie
   axis +) AND Cassel asserts power (power-weakness axis −) gets
   reduced to one. The planner downstream treats the scene as
   single-axis, which propagates into beat-expansion and writing.

2. The polarity 0 case ("flat — no movement") plus the
   "structurally a transitional / montage / connective scene"
   gloss (line 47) tag legitimate connective scenes as flat. But
   the planner reads "polarity 0" as a flat scene and the writer
   produces flat prose. The corpus reference shows ~10-15% of
   scenes are genuinely 0; the generated outputs show 0% because
   the planner avoids them. The extractor's anchor is fine; the
   downstream consumption is broken — but the extractor's gloss
   is what the planner internalizes.

### Where the prompt overconstrains

- The 11-element lifeValue enum + "other" with the "SHOULD be rare"
  flag (line 35) primes the model toward the named axes even when
  a scene moves on a hybrid axis. "Identity-unknown" is itself a
  hybrid; introducing it as canonical encourages the model to
  collapse hybrids into the named hybrid axis rather than emitting
  multiple.

### Proposed before/after edit

Original line 64-65:

```
3. ONE life value per scene — pick the dominant axis. If two axes seem equally dominant, pick the one with the higher emotional stakes.
```

Proposed replacement:

```
3. PRIMARY life value per scene — the axis that bears the scene's
   dramatic weight. If a second axis also moves clearly, emit it
   as `secondary_lifeValue` with its own valueIn/valueOut. Most
   scenes are single-axis; do not force a secondary unless the
   second axis genuinely moves. The post-extraction validator will
   audit secondary-emission rate and flag if it exceeds 30%.
```

Schema change: add `secondary_lifeValue`, `secondary_valueIn`,
`secondary_valueOut` as optional fields.

### Test plan

- Re-run on Salvatore Crystal Shard with new schema. Operator-
  review 20 scenes the extractor previously tagged single-axis to
  see if any genuinely moved on two axes. Cost: ~$0.10 + 1 hour
  operator time.
- Stop gate: secondary-axis emission rate between 15-30%; operator
  agreement on >70% of secondary tags. If secondary fires above
  30% the extractor is over-multiplexing; tighten.

---

# Cross-cutting Recommendations

### Recommendation R1: Promote J1 (endpoint landing, prose) into the discernment harness as a first prose-layer judge

- **Layer optimized**: L4 (eval/judge layer)
- **Exact proposed change**: add the J1 dimension definition to
  `scripts/evals/planner-discernment-real-data.ts` (or a sibling
  prose-discernment runner) using the rubric in Part A, applied to
  the chapter-final 250-word window of generated chapters.
- **Expected storytelling benefit**: chapters whose endpoints don't
  land become labeled signals operators can prioritize for plan
  rewrite or chapter regeneration. The discernment v0 work showed
  the dimension is operator-meaningful at the plan level; moving it
  to prose closes the loop.
- **Downstream risks**: J1 may saturate on Salvatore-corpus quality
  prose (most chapters land); the calibration set must include
  enough lower-quality cases to keep the dimension informative.
- **How to test it cheaply**: run J1 against the existing
  `output/semantic-gate-baseline-*` chapters. ~$0.10 for 30 chapters.
  Compare label distributions to operator review on a 10-chapter
  sample.
- **What data would prove value**: J1 must hit J ≥ 0.85 on a 30-case
  authored fixture AND must distribute across all 4 levels on real
  data (no flat saturation at one level).
- **What should remain unchanged**: planner outputs, writer outputs,
  any UI surface, runtime defaults. J1 is diagnostic-only on first
  promotion.

### Recommendation R2: Adopt the "infer-first, then compare to declared" structure as a standard pattern for planner-claim verification

- **Layer optimized**: L4 (eval/judge methodology)
- **Exact proposed change**: any judge that scores prose against a
  planner declaration (J1 against `chapter.purpose`, J2 against scene
  function, J4 against declared arc, J5 against declared world facts,
  J6 against declared promise) MUST require the model to first
  describe what it observes from prose alone, THEN compare to the
  declaration. Encode this as a section header in the
  `docs/evals/judge-design-principles.md` rubric authoring guide.
- **Expected storytelling benefit**: prevents the broad pairwise
  bias that broke method-pack-planner-semantic-judge-v0 by forcing
  the judge to commit to its own observation before being given the
  planner's claim. This is the structural fix for the Plan-A bias.
- **Downstream risks**: longer prompts (~50-100 extra tokens per
  judge), small additional cost.
- **How to test it cheaply**: A/B the existing J2-style rubric vs.
  the same rubric without infer-first across 24 calibration cases.
  ~$0.05.
- **What data would prove value**: J ≥ 0.85 with infer-first AND
  the inferred-vs-declared mismatch field captures known
  mismatches at >80% recall on adversarial cases.
- **What should remain unchanged**: existing single-dimension
  discernment shape; this is additive structure within each rubric.

### Recommendation R3: Decouple beat-description length from "writer creative latitude" framing

- **Layer optimized**: L1 (planner prompt — beat-expansion)
- **Exact proposed change**: replace the "Each beat description must
  be 1-2 sentences. Longer descriptions constrain the writer's
  creative latitude" instruction with the 3-element
  expectation/pressure/change-of-state structure proposed in Part B.
- **Expected storytelling benefit**: beats become load-bearing for
  the writer instead of empty placeholders, addressing the
  saturation finding on `causalMomentum` and `endpointLanding`.
- **Downstream risks**: longer beat descriptions may reduce the
  writer's variation; some writers need short descriptions. Test
  in A/B before promoting.
- **How to test it cheaply**: A/B 6 chapter beat-expansions per the
  Part B test plan. ~$0.65.
- **What data would prove value**: SCENE-2/3 rate lifts ≥ 15 pp OR
  AGENCY-2/3 rate lifts ≥ 15 pp on the J2/J3 panel.
- **What should remain unchanged**: beat schema (no new fields),
  no-dialogue rule, beat count formula.

### Recommendation R4: Remove the cliché blocklist from the writer prompt; replace with positive directive + deterministic post-lint

- **Layer optimized**: L2 (writer prompt) + L3 (deterministic lint)
- **Exact proposed change**: drop the 10-item AI-cliché blocklist
  from `prose-writer-system.md` line 45-55; replace with the single
  positive directive in Part B. Move cliché detection into the
  existing `src/lint/quality-detectors.ts` repetition pattern with a
  `clicheDetector` companion that fires on the same 10 patterns.
- **Expected storytelling benefit**: removes priming surface area
  and unblocks paragraph variation. Per the 2026-04-20 priming-
  suppression lesson, blocklists may help or hurt; the discipline
  is to A/B before assuming.
- **Downstream risks**: cliché fire rate may increase. Mitigation:
  the deterministic detector catches what the blocklist would have
  caught, with the option to apply rewrites.
- **How to test it cheaply**: A/B 6 chapters. ~$0.50.
- **What data would prove value**: cliché-fire rate must NOT
  increase >5 absolute pp; J7 readability rate must NOT decrease.
- **What should remain unchanged**: scene structure rules, sensory
  anchoring guidance, the rest of the writer prompt.

### Recommendation R5: Adopt MICE thread-typed chapter purposes as the planner's primary structural contract

- **Layer optimized**: L1 (planner prompt — chapter outline)
- **Exact proposed change**: rewrite the structural-requirements
  section of `chapter-outline-system.md` per Part B, requiring each
  chapter to declare its dominant MICE thread role (opens /
  progresses / closes) with the four-letter code in `purpose`.
- **Expected storytelling benefit**: ties the planner explicitly to
  the corpus extractor's output (`structure-mice`), enabling
  downstream auditability and reducing the "checklist satisfaction"
  failure mode.
- **Downstream risks**: planners may emit valid thread tags but
  unbalanced sequences (e.g., always "progresses"). The
  contraindication rules in the proposed prompt mitigate the
  obvious cases.
- **How to test it cheaply**: A/B 12 chapter outlines (~$0.40). Run
  J1 + J3 on downstream chapters (~$0.30). Total ~$1.50.
- **What data would prove value**: J1 (endpoint) median lifts ≥ 1
  level OR J3 (agency) median lifts ≥ 1 level. Plus, the emitted
  MICE-thread sequence has at least 60% balanced opens-and-closes
  ratio at the novel level.
- **What should remain unchanged**: chapter schema (purpose field
  remains a string), beat-expansion stage, writer.

### Recommendation R6: Add applicability filtering to all judges by default

- **Layer optimized**: L4 (eval/judge harness)
- **Exact proposed change**: every judge in this document specifies
  `Stop conditions`. The discernment harness must enforce these
  before dispatching judge calls. Codify this as a contract: judges
  emit an `applicability_skip` row when stop conditions hit, and
  these rows are reported separately from low-label rows.
- **Expected storytelling benefit**: prevents the "method-pack
  regresses relationship movement" framing artifact that emerged
  before applicability filtering was added in v0. Skip-aware
  reporting protects the judge's accuracy claims.
- **Downstream risks**: harness complexity. Mitigation: the harness
  already supports applicability skips for relationshipDelta /
  characterMateriality / worldFactPressure (per
  `planner-discernment-real-data-v0`). Generalize the pattern.
- **How to test it cheaply**: re-run the existing J=relationshipDelta
  applicability shape on the new judges. ~$0.
- **What data would prove value**: across the 7 judges, the
  applicability skip rate stabilizes between 10-40% on real data
  AND reported label distributions are NOT systematically skewed
  by skip-ineligible cases.
- **What should remain unchanged**: discernment v0 fixtures and
  rubrics.

### Recommendation R7: Treat the Salvatore writer-prompt blocklist as a load-bearing prompt artifact and A/B before any change

- **Layer optimized**: L2 (Salvatore writer prompt)
- **Exact proposed change**: do NOT auto-promote the blocklist
  removal proposed in Part B without a paneled A/B per
  `feedback_priming_suppression_ab.md`. Schedule a 16-beat A/B as
  the next experiment after R3 lands.
- **Expected storytelling benefit**: either confirms the blocklist
  is load-bearing (and we know to keep it explicit) or removes
  ~280 priming tokens (and we know to delete it).
- **Downstream risks**: blocklist removal could double the
  proper-noun violation rate as it did in 2026-04-20. The
  deterministic post-lint catches the violations regardless; the
  cost is rework.
- **How to test it cheaply**: 16-beat A/B at ~$0.25.
- **What data would prove value**: paired-sample comparison
  shows blocklist-violation delta ≤ +2 absolute pp AND no
  qualitative regression on Sonnet review.
- **What should remain unchanged**: the corpus blocklist as a
  POST-prose deterministic check; the writer's other Salvatore-
  specific guidance.

### Recommendation R8: Author a judge-design-principles doc that codifies the 5 patterns this document used

- **Layer optimized**: L4 (eval methodology)
- **Exact proposed change**: write `docs/evals/judge-design-principles.md`
  capturing the five patterns: (1) single dimension per judge,
  (2) anchored categorical labels with lowest-fit rule, (3) infer-
  first then compare to declared, (4) magnitude/direction
  separation when applicable, (5) granularity stability check at
  both calibration and production-emit granularity per "Gold
  stability first."
- **Expected storytelling benefit**: future judges (J8, J9, mystery-
  genre judges, etc.) inherit the patterns rather than each judge
  re-deriving them.
- **Downstream risks**: doc maintenance burden if the patterns
  evolve. Mitigation: keep the doc slim and link out to the
  v0 calibration findings for evidence.
- **How to test it cheaply**: doc-only; review by Codex via
  `codex:codex-rescue --model gpt-5.5 --effort high` for
  adversarial review before committing.
- **What data would prove value**: a new judge built using the
  doc's patterns hits J ≥ 0.85 on first calibration without
  pattern-debug iterations.
- **What should remain unchanged**: existing v0 rubrics until
  re-calibrated.

### Recommendation R9: Score every judge for granularity stability at promotion time, not as an afterthought

- **Layer optimized**: L4 (eval methodology)
- **Exact proposed change**: enforce the "Gold stability first
  (granularity-aware)" feedback as a promotion gate. A judge is
  not promoted from diagnostic to operator-queue use without J ≥
  0.85 demonstrated at BOTH the calibration-anchor granularity
  AND the production-emit granularity. Failures default to
  data-only binary collapse before re-labeling.
- **Expected storytelling benefit**: prevents the gold-stability
  failures the user has already flagged as a recurring pattern.
- **Downstream risks**: slower judge promotion path. Mitigation:
  this IS the lesson; don't fight it.
- **How to test it cheaply**: codify in the
  `judge-design-principles.md` from R8 plus a CI test that
  blocks judges from being marked "promoted" without granularity
  stability evidence in their result doc.
- **What data would prove value**: zero gold-stability rollbacks
  in the next 6 months.
- **What should remain unchanged**: existing judges that already
  cleared this bar; calibration fixtures.

### Recommendation R10: Hold all multi-judge prose panels behind operator review for the first 60 days

- **Layer optimized**: L5/L6 (operator review surface, runtime
  policy)
- **Exact proposed change**: even after J1-J7 calibrate, do not
  wire any judge as a planner-rewrite blocker, writer-rewrite
  blocker, or autonomous-promotion gate for at least 60 days
  after first cohort run. Use them only as operator review queues
  with diagnostic-only routing per the existing
  `diagnostics:planner-discernment-finding-aggregate` pattern.
- **Expected storytelling benefit**: prevents the noisy-LLM-checker
  failure mode in a new direction. The user's "Don't calibrate
  noisy LLM checkers" feedback applies to checkers that never
  reach gold-stability; the prose-layer judges in this document
  are designed to clear gold stability, but the same caution
  applies to using them as automated gates before operator
  review demonstrates they ARE that reliable on real data.
- **Downstream risks**: slower feedback loop. Acceptable.
- **How to test it cheaply**: operator review weekly during the
  60-day window. Cost: human time.
- **What data would prove value**: 60-day operator agreement rate
  ≥ 80% on judge-flagged issues. If lower, the judges remain
  diagnostic indefinitely.
- **What should remain unchanged**: any existing autonomous
  policy (none currently for these surfaces); runtime defaults.

---

## End notes

Decision document, not promotion proposal. None of the seven judges,
prompt edits, or ten recommendations are pre-authorized for runtime
change. Each requires its test plan, calibration evidence, and
operator review pass before promotion.

Highest-leverage next experiment: J1 + J2 + J3 panel on the existing
v0 cohort. Under $1 to run; tells us within a day whether the
prose-layer dimension shift is informative on real data.
