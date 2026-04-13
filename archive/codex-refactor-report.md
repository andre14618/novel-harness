---
status: active
created: 2026-04-08
source: NovelCrafter Codex feature analysis mapped to codebase
---

# Codex-Inspired Refactor Report

Mapping NovelCrafter's Codex feature set against the harness surfaces five concrete
structural improvements. Each is grounded in an existing code gap — not speculative
features — and ranked by prose quality impact.

---

## 1. Locations as First-Class DB Entities (High)

**What's missing.**  
Locations are `{name, description, sensoryDetails}` JSON blobs stored inside
`world_bibles.content_json`. They never make it into Postgres as queryable rows.

The result: `formatSetting()` in `src/agents/writer/beat-context.ts:144–156` does
fuzzy JavaScript string-matching over an in-memory array. If the beat says
`setting: "the tavern"` and the world bible has `"The Rusty Nail Tavern"`, it
misses. The writer gets no sensory grounding for that beat.

There's also a `location_events` lookup type in the reference-resolver
(`src/agents/writer/reference-resolver.ts:120–128`) that queries `getEventsAtLocation`
— but since location strings aren't normalized, the match is unreliable.

**The refactor.**  
Promote locations to a `locations` table (migration 016):

```sql
CREATE TABLE IF NOT EXISTS locations (
  id          TEXT NOT NULL,
  novel_id    TEXT NOT NULL REFERENCES novels(id),
  name        TEXT NOT NULL,
  description TEXT NOT NULL,
  sensory_details TEXT NOT NULL DEFAULT '',
  aliases_json JSONB NOT NULL DEFAULT '[]',  -- "the tavern", "Rusty Nail"
  embedding   vector(1536),
  tsv         tsvector,
  PRIMARY KEY (novel_id, id)
);
```

- World-builder saves locations to this table (alongside the existing world_bible blob).
- `formatSetting()` becomes a DB lookup with alias matching instead of JS fuzzy matching.
- Add `locations` as a 7th leg in the RRF search in `src/db/retrieval.ts` — setting
  context then benefits from semantic retrieval just like facts and events do.
- `getEventsAtLocation` can JOIN against `locations.aliases_json` for reliable matching.
- `timeline_events.location` becomes a foreign key reference (or at least matched
  against `locations.id` at insert time).

**Quality impact.**  
Beat-0 and location-change beats currently risk empty setting context. This makes them
deterministically reliable and lets the writer get sensory details even when the beat
uses a location shorthand.

---

## 2. Story Objects Table (High)

**What's missing.**  
The reference-resolver's `IMPLICIT_MARKERS` list includes:
`"the letter"`, `"the deal"`, `"the offer"`, `"the promise"`, `"the secret"`,
`"the lie"` (lines 28–35 in `reference-resolver.ts`). These are all *persistent
narrative objects* — things that exist across scenes and carry history.

Currently, when a beat says "she held the letter that started everything," the
resolver fires the LLM (Llama 8B on Groq) to figure out what lookups to do, then
falls back to `recent_events` for the involved characters. The letter itself has no
structured representation. Its content, origin, who-sent-it, and where-it-is now are
buried in prose somewhere.

**The refactor.**  
Add a `story_objects` table:

```sql
CREATE TABLE IF NOT EXISTS story_objects (
  id                   TEXT NOT NULL,
  novel_id             TEXT NOT NULL REFERENCES novels(id),
  name                 TEXT NOT NULL,          -- "the letter", "Mira's locket"
  category             TEXT NOT NULL,          -- artifact|document|agreement|promise|secret
  description          TEXT NOT NULL,
  origin_chapter       INTEGER NOT NULL,
  current_holder_id    TEXT,                   -- character_id or NULL
  aliases_json         JSONB NOT NULL DEFAULT '[]',
  significance         TEXT NOT NULL DEFAULT '',
  embedding            vector(1536),
  tsv                  tsvector,
  PRIMARY KEY (novel_id, id)
);
```

Objects are extracted by the `relationship-timeline` agent (which already tracks
knowledge, events, and awareness changes — adding objects is a natural extension to
its schema). Or a dedicated `object-tracker` extraction step.

Add `story_objects` as a 4th lookup type in the reference-resolver
(alongside `recent_events`, `relationship`, `location_events`, `knowledge`). When a
beat mentions "the letter," the resolver does a vector search against
`story_objects` instead of calling the LLM.

Also add to the 7-table RRF search so the beat-writer sees object context in
long novels where an artifact was introduced 15 chapters ago.

**Quality impact.**  
Eliminates the LLM call in the reference-resolver for the most common implicit
markers. Makes object continuity (who holds what, what was promised, what was signed)
checkable by the continuity checker.

---

## 3. Subplots as First-Class Entries (Medium)

**What's missing.**  
`chapter_summaries.open_threads_json` is a flat string array extracted per-chapter.
There's no cross-chapter view of subplot lifecycle. The planning-plotter has no way to
query "which threads are still open at chapter 12" — it only knows what the current
chapter summary says.

This matters because long novels need to close what they open. The chapter-plan
checker can verify that a chapter advances its beats, but it can't verify that a
chapter resolves a thread that the plotter said would resolve here.

**The refactor.**  
Add a `subplots` table:

```sql
CREATE TABLE IF NOT EXISTS subplots (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  novel_id             TEXT NOT NULL REFERENCES novels(id),
  name                 TEXT NOT NULL,
  description          TEXT NOT NULL,
  status               TEXT NOT NULL DEFAULT 'open',  -- open|dormant|resolved|abandoned
  introduced_chapter   INTEGER NOT NULL,
  resolved_chapter     INTEGER,
  characters_json      JSONB NOT NULL DEFAULT '[]',   -- involved character IDs
  embedding            vector(1536),
  tsv                  tsvector
);
```

Two integration points:

1. **Extraction**: The `summary-extractor` agent currently produces `open_threads_json`
   as strings. Extend the schema to produce structured subplot updates: `{name, status,
   involvedCharacters}`. The extractor upserts to `subplots` — new names create rows,
   status changes update `status` + `resolved_chapter`.

2. **Planning context**: The planning-plotter receives the current open subplot list
   as part of its context for chapters beyond the first. This closes the loop where the
   plotter knows which arcs need to land.

The `open_threads_json` column on `chapter_summaries` stays — it's the raw extraction
output. The `subplots` table is the normalized view built on top of it.

**Quality impact.**  
Gives the plotter and the chapter-plan checker a queryable subplot ledger. Enables
a future "unresolved subplot" continuity check: flag chapters near the end of the
novel where a thread is still open.

---

## 4. Character Aliases (Medium)

**What's missing.**  
Characters have one canonical name in the `characters` table. When a beat refers to
"Detective Marsh" (the occupation + last name form) but the canonical name is
"Sarah Marsh," the adherence-checker string match fails, the reference-resolver
misses the character lookup, and the continuity checker may not flag a violation
involving her.

This is a simple but pervasive gap for any novel with characters who go by different
names in different contexts (title, nickname, family name, first name).

**The refactor.**  
Add a `character_aliases` table:

```sql
CREATE TABLE IF NOT EXISTS character_aliases (
  novel_id      TEXT NOT NULL,
  character_id  TEXT NOT NULL,
  alias         TEXT NOT NULL,
  context       TEXT NOT NULL DEFAULT '',  -- "formal address", "family name", "nickname"
  PRIMARY KEY (novel_id, character_id, alias)
);
```

The character-agent schema is extended to output an `aliases[]` field. The
concept phase saves aliases alongside character profiles.

Update the adherence-checker's character-presence logic
(`src/agents/adherence-checker/`) to JOIN against aliases. Update
`resolveReferences()` to match aliases when searching by character name.

**Quality impact.**  
Low individual impact; cumulative impact on adherence accuracy in novels with
formal address conventions, military ranks, or multi-POV casts where characters
refer to each other differently than their canonical name.

---

## 5. Structured Character Quick-Facts (Low)

**What's missing.**  
The `characters` table has a single `profile_json JSONB` column. The character-agent
outputs a structured schema (speech pattern, emotional baseline, relationships, etc.)
but it all lands in an opaque blob. Agents that need `speechPattern` have to extract
it from `profile_json->>'speechPattern'` — which works, but makes any schema change
invisible to the type system.

**The refactor.**  
Promote the most-queried character fields out of `profile_json` into typed columns:

```sql
ALTER TABLE characters
  ADD COLUMN speech_pattern TEXT NOT NULL DEFAULT '',
  ADD COLUMN occupation      TEXT NOT NULL DEFAULT '',
  ADD COLUMN physical_desc   TEXT NOT NULL DEFAULT '';
```

`beat-context.ts:117` already accesses `char.speechPattern` directly (typed via
`CharacterProfile`). This is about making the DB schema match the type contract so
a migration or schema change can't silently break the query path.

The `profile_json` column stays for everything else — this is not a full
normalization, just surfacing the three fields that are hot in the beat loop.

**Quality impact.**  
Primarily a maintenance/correctness improvement. No direct prose quality impact, but
reduces the risk of a profile_json schema drift silently breaking speech-pattern
injection in the beat context.

---

## Priority Order

| # | Refactor | Value driver |
|---|---|---|
| 1 | Locations table | Fixes empty beat-context for setting-change beats |
| 2 | Story objects table | Makes reference-resolver deterministic for the most common implicit markers |
| 3 | Subplots table | Closes the planner-continuity loop for long novels |
| 4 | Character aliases | Fixes adherence false-negatives in formal/nickname-heavy casts |
| 5 | Character quick-facts columns | Schema hygiene, not prose quality |

Items 1 and 2 are the most impactful and self-contained. Item 3 requires coordination
between the summary-extractor schema and the planning-plotter context builder.
Items 4 and 5 are small and low-risk.

---

## What NovelCrafter Has That's Deliberately Out of Scope

- **Mention tracking** (reverse index: prose → codex entity). Interesting but the
  harness extracts *from* prose post-hoc — a forward index is redundant. The
  continuity checker already catches entity misuse.
- **Character interviews** (AI-powered interactive exploration). This is an authoring
  UX feature, not pipeline infrastructure.
- **Series/universe sharing**. The harness is per-novel; multi-novel support is a
  separate scope.
- **Arc visualization UI**. The data exists across `character_states` and
  `relationship_states`. This is a `/app` UI page, not a data refactor.
