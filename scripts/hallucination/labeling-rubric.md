# Hallucination labeling rubric (v2 — for κ ≥ 0.7 agreement)

## Task

Label each beat as `pass` (no issues) or `fail` (has issues). For `fail` beats, list every offending entity with a context excerpt.

## Definitions

A beat **fails** if its prose contains ANY of:

### A. Corpus leakage (always fail, no exceptions)

Any of these tokens appearing in prose, regardless of context. These are R.A. Salvatore / Forgotten Realms canonicals that must NEVER appear in non-Salvatore novels:

**Characters**: Drizzt, Bruenor, Wulfgar, Regis, Catti-brie, Catti, Rumblebelly, Akar Kessell, Dendybar, Sydney, Alustriel, Malchor, Pook, Pasha Pook, Cassius, Deudermont, Dendybar, Heafstaag, Kemp, Revjak, Jensin Brent, Glensather, Biggrin, Entreri, Jarlaxle, Zaknafein, Guenhwyvar, Moradin, Halvar Dray, Foulweather Brennan

**Places**: Mithril Hall, Mithral Hall, Icewind Dale, Ten-Towns, Lonelywood, Bryn Shander, Targos, Caer-Konig, Caer-Dineval, Termalaine, Easthaven, Dougan's Hole, Good Mead, Calimport, Silverymoon, Longsaddle, Mirabar, Sundabar, Luskan, Maer Dualdon, Lac Dinneshere, Kelvin's Cairn, Spine of the World, Cryshal-Tirith, Hosttower, Harpells, Sword Coast, Silver Marches, Forgotten Realms, Faerûn

**Items**: Crystal Shard, Crenshinibon, Aegis-fang, Twinkle, Icingdeath, Taulmaril, Heartstealer

**Races**: drow, Dark Elves, Underdark, verbeeg, duergar, svirfneblin

**Naming patterns**: Do'Urden suffix on a character name (e.g. "Yun Sael Do'Urden"), Battlehammer surname, House of Daermon N'a'shezbaernon

### B. Ungrounded named entity (fail)

A proper noun (person, place, named organization, named item, named system, named protocol) that appears in `prose` but does NOT appear in any of:
- `speakers` keys (the speaker names)
- `brief.characters` (the listed characters for this beat)
- `brief.setting` (the named setting)
- `world_bible_excerpt.locations[].name`
- `world_bible_excerpt.cultures[].name`
- `world_bible_excerpt.world_systems[].name`

**Examples to flag**:
- "Vexin" appearing as a character when no Vexin is in the speakers/brief
- "Dwarvendarrow" appearing as a place when world_bible doesn't list it
- "Equation Theta-Nine" appearing as a named protocol when systems don't include it
- "Elena Ferreira" when the grounded character is "Ines Ferreira" (name drift = hallucination)

**Examples NOT to flag** (BENIGN — these are pass):
- Generic English nouns capitalized at sentence start ("Then", "Now", "First", "Second")
- Days of the week, months ("Tuesday", "March")
- Real-world technical terms used descriptively ("EPA", "DNA", "CPR")
- Real-world place names used as analogues ("Kuiper Belt" in sci-fi, "Baton Rouge" in contemporary)
- Generic titles without proper-name attached ("the Captain", "the General", "the Empire", "the Healer")
- In-prose item descriptions that aren't named ("the silver dagger", "an old sword")
- Cardinal/ordinal positional names ("Bed Seven", "Sector Gamma", "Room Three", "Pier Nine") — these are coordinates, not named entities

### C. Edge cases (resolution rules)

| Case | Resolution |
|------|-----------|
| Last name appears alone but full name is in `speakers` (e.g. "Dunmore" when speakers has "Sylvie Dunmore") | PASS — alias of grounded character |
| First name + new last name (e.g. "Sylvie Vance" when speakers has "Sylvie Dunmore") | FAIL — name drift |
| Title + grounded last name (e.g. "Healer Dunmore") | PASS — title alias |
| New character introduced ONLY in dialogue ("Pellan said hello" with no Pellan grounded) | FAIL — introducing ungrounded named character |
| Generic-noun surname that could be coincidence ("Officer Dale" — not Icewind Dale) | FAIL as ungrounded character (not corpus leak) |
| Plural faction name not in cultures list ("the pirates", "the Starspitters") | FAIL — ungrounded faction |
| Sentence-initial capitalized word that is a real word lowercased elsewhere | PASS — common noun |

## Output schema

```json
[
  {
    "id": <id from input>,
    "pass": true | false,
    "issues": [
      {
        "entity": "<the offending token or phrase, exactly as it appears in prose>",
        "excerpt": "<10-30 word context span containing the entity>"
      }
    ]
  }
]
```

`issues` is empty when `pass: true`. List every distinct offending entity (one per object). Multiple mentions of the same entity count as ONE issue (use the most informative excerpt).

## Method (REQUIRED — do not skip)

1. Read every beat manually. Do not regex-only filter.
2. For each capitalized proper-noun candidate in prose, classify by the rules above.
3. Apply the resolution rules from section C for edge cases.
4. Write the JSON file.

## Reference labels (the gold set — anchor your decisions to these)

### GOLD #1: PASS

```
Brief speakers: ["Sylvie Dunmore", "Corporal Jien"]
World bible locations: ["Field Hospital Tent", "Veridian Camp"]
Prose: "Sylvie tightened the bandage. Corporal Jien watched from the tent flap, his rifle resting across his knees."
```

→ `pass: true`, `issues: []`. All names grounded; "rifle" and "tent flap" are descriptions.

### GOLD #2: FAIL — corpus leakage

```
Brief speakers: ["Yun Sael", "Mao Rin"]
Prose: "Yun Sael gripped the crystal shard tighter, her thoughts drifting to the mithril hall where she had once trained."
```

→ `pass: false`, `issues: [{entity: "crystal shard", excerpt: "...gripped the crystal shard tighter..."}, {entity: "mithril hall", excerpt: "...the mithril hall where she had once trained"}]`. Both are Salvatore-corpus leaks.

### GOLD #3: FAIL — ungrounded named entity

```
Brief speakers: ["Sylvie Dunmore"], characters: ["Sylvie Dunmore", "General Voss"]
World bible locations: ["Field Hospital", "Command Tent"]
Prose: "Sylvie remembered the old farm in Whitestone, where Master Eldric had taught her the basics of healing."
```

→ `pass: false`, `issues: [{entity: "Whitestone", excerpt: "the old farm in Whitestone"}, {entity: "Master Eldric", excerpt: "Master Eldric had taught her"}]`. Both are introduced names not in any grounded set.

### GOLD #4: PASS — generic titles + grounded aliases

```
Brief speakers: ["Healer Dunmore", "General Voss"]
Prose: "The Healer worked through the night. The General watched from his cot, his gaze cold."
```

→ `pass: true`. "The Healer" and "The General" are title-aliases of grounded characters; titles capitalized in fiction is normal.

### GOLD #5: FAIL — name drift

```
Brief speakers: ["Yuki Tanabe"]
Prose: "Yuki Tanaka logged the data and sent it to the central archive."
```

→ `pass: false`, `issues: [{entity: "Yuki Tanaka", excerpt: "Yuki Tanaka logged the data..."}]`. Name drifted from Tanabe → Tanaka, AND "central archive" is potentially ungrounded — flag if not in world bible.

### GOLD #6: PASS — real-world reference is fine

```
Brief: sci-fi setting on a Mars colony
Prose: "The launch window was tight — only 18 hours before Earth-Mars alignment closed."
```

→ `pass: true`. "Earth", "Mars" are real-world bodies, OK in sci-fi context.

---

When in doubt: **err on the side of PASS for edge cases (titles, real-world refs, coordinates), FAIL for unambiguous new names.**
