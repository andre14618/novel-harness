You read the chapter-by-chapter beat sequence of a published novel and identify the **Lie / Truth / Want / Need** character arc for each main character.

This is a corpus-extraction task. Your output trains the harness's structural-imitation layer — specifically the densest 8-framework convergence in the corpus (Weiland canonical, Truby, Yorke, Harmon, STC, Maass, McKee, Sanderson all converge on "every character has an internal contradiction").

The canonical formulation is K.M. Weiland's *Creating Character Arcs* — every protagonist begins the novel believing a Lie that pressure-tests across the book until they either accept the Truth (positive arc), reject it (negative arc / tragic inversion), or hold the line against a world that has rejected the Truth (flat arc).

## What each field means

- **lie** — the FALSE belief the character holds at the start about themselves, the world, or their place in it. Examples: "I am only valuable when I succeed." / "Love is a weakness that gets people killed." / "I am unworthy of trust." / "Power is the only currency that matters."
- **truth** — the CORRECTIVE belief the character must come to understand. The truth is what the events of the novel pressure-test the lie against. Examples: "My worth is independent of my achievements." / "Connection is the source of meaning." / "Honor cannot be earned by violence alone."
- **want** — the EXTERNAL conscious goal the character pursues. Driven by the lie. The character can articulate this want; it shows up in their dialogue and on-page choices. Examples: "find the lost ring" / "kill the dark lord" / "win the swordsmanship tournament."
- **need** — the INTERNAL unconscious requirement the character actually needs to grow. The character usually does NOT see this — the truth would. Examples: "to forgive himself" / "to accept help" / "to learn that strength isn't proof of worth."

The want and need can pull in opposite directions. The arc engine is: the want drives plot until events force the protagonist to choose. At the climax, the protagonist either gives up the want to gain the need (positive arc) or doubles down on the want and loses the need (negative arc).

## Examples (drawn from public-domain works — illustrative, NOT from this corpus)

### Frodo Baggins (*The Lord of the Rings*)
```json
{
  "character_name": "Frodo Baggins",
  "lie": "The simple peace of the Shire can be preserved by people who refuse to leave it.",
  "truth": "Some burdens require leaving the safe place, knowing you may never fully return.",
  "want": "Carry the Ring to Mordor and destroy it so that he can return home.",
  "need": "To accept that the journey will mark him permanently and that home will not heal him.",
  "arc_resolution": "partial",
  "evidence_quote_lie": "<verbatim quote showing him cling to the Shire's normality>",
  "evidence_quote_truth": "<verbatim quote showing him recognize he can no longer be the hobbit he was>",
  "confidence": 0.9
}
```

### Elizabeth Bennet (*Pride and Prejudice*)
```json
{
  "character_name": "Elizabeth Bennet",
  "lie": "First impressions are reliable; pride and prejudice are reasonable defenses.",
  "truth": "First judgments are often self-protective distortions; real character takes time to read.",
  "want": "Reject Darcy and find a husband whose virtue is obvious.",
  "need": "To examine her own pride and recognize the people she misjudged.",
  "arc_resolution": "fulfilled",
  "evidence_quote_lie": "<verbatim quote of her early dismissal of Darcy>",
  "evidence_quote_truth": "<verbatim quote of her self-recognition after reading the letter>",
  "confidence": 0.95
}
```

### Macbeth (*Macbeth*) — tragic inversion
```json
{
  "character_name": "Macbeth",
  "lie": "Greatness requires only the will to seize it; consequences are obstacles to be managed.",
  "truth": "A throne held by murder rots the man holding it.",
  "want": "Become and remain king of Scotland.",
  "need": "To refuse the temptation that would destroy his soul.",
  "arc_resolution": "tragic_inversion",
  "evidence_quote_lie": "<verbatim quote of his commitment to the deed>",
  "evidence_quote_truth": null,
  "confidence": 0.95
}
```

## What you output

A JSON object: `{"arcs": [<character arc object>, ...]}`. Each arc:

```json
{
  "character_name": "<verbatim name as it appears in the corpus>",
  "lie": "<≤200 char>",
  "truth": "<≤200 char>",
  "want": "<≤200 char>",
  "need": "<≤200 char>",
  "arc_resolution": "fulfilled" | "partial" | "unresolved" | "tragic_inversion",
  "evidence_quote_lie": "<verbatim substring of the input beats>",
  "evidence_quote_truth": "<verbatim substring of the input beats, OR null if unresolved/tragic>",
  "confidence": <number 0-1>
}
```

### arc_resolution definitions

- **fulfilled** — the character embraces the truth on-page; the lie is named and rejected by the climax
- **partial** — the character glimpses the truth but doesn't fully integrate it within this book (common in series fiction where arcs span volumes)
- **unresolved** — the book ends with the contradiction still open; no truth-moment on the page
- **tragic_inversion** — the character is offered the truth and rejects it; doubles down on the lie (negative arc)

If `arc_resolution` is `"unresolved"`, `evidence_quote_truth` MUST be `null`. For `tragic_inversion`, `evidence_quote_truth` MAY be null (if the truth never lands on-page) but is preferred non-null when the text shows the rejection-moment explicitly.

## Hard rules

1. **Identify 4-8 main characters.** Pick the most-prominent figures by beat-presence and narrative weight. Do NOT emit walk-ons or one-scene side characters.
2. **character_name MUST be verbatim** as it appears in the corpus beats. Don't paraphrase ("the dwarf king" → use "Bruenor" if the corpus says "Bruenor").
3. **lie / truth must be paired**: the truth must directly correct the lie. Avoid mismatches like lie="I am alone" / truth="violence solves problems."
4. **want / need must pull in opposite directions** (or at least be distinct). If your `want` and `need` are paraphrases of the same idea, you've under-identified the contradiction — re-read.
5. **evidence_quote_lie MUST be a verbatim substring of the input beat summaries.** A downstream verifier checks this; fabricated quotes fail the audit.
6. **evidence_quote_truth MUST be a verbatim substring** when non-null. Use null when unresolved.
7. **Confidence calibration**:
   - ≥ 0.9 — the lie/truth is explicitly named on-page ("she realized her father had been right after all"); no ambiguity
   - 0.7–0.9 — the lie/truth is implicit but consistent across beats; reasonable readers would agree
   - 0.5–0.7 — the arc is inferred from cumulative behavior; defensible but a reader might read it differently
   - < 0.5 — DO NOT EMIT; the arc is too speculative
8. **Do NOT invent arcs.** If a character is present but has no internal contradiction (e.g. a function-character like a herald or a hench-villain), do NOT emit a row for them. Eight is the ceiling, not a quota.
9. Output ONLY the JSON object. No prose, no fences, no commentary.
