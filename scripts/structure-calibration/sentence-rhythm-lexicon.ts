/**
 * Pattern 34 bundle — Sentence rhythm and lexicon analyses.
 *
 *  34a — Sentence length by beat-kind (extends P29 with kind axis).
 *  34b — Top-50 action verbs per book (Salvatore action verb signature).
 *  34c — Adverb density (-ly suffix) per 100 words per book.
 *  34d — Interiority marker density per book and per beat-kind.
 *
 * Pure compute on beats.jsonl. Zero LLM cost.
 *
 * Outputs four timestamped JSON files (NEVER overwrite):
 *   - crystal_shard.<TS>.sentence-length-by-kind.json
 *   - crystal_shard.<TS>.action-verb-lexicon.json
 *   - crystal_shard.<TS>.adverb-density.json
 *   - crystal_shard.<TS>.interiority-marker-density.json
 */

import { readFileSync, writeFileSync } from "node:fs"

const BEATS = "/Users/andre/Desktop/personal_projects/novel-harness/novels/salvatore-icewind-dale/beats.jsonl"
const OUT_DIR = "/Users/andre/Desktop/personal_projects/novel-harness/novels/salvatore-icewind-dale/structure-calibration"

type Beat = {
  book: string
  chapter: string | number
  beat_idx: number
  kind: string
  words: number
  text: string
}

const lines = readFileSync(BEATS, "utf-8").trim().split("\n")
const beats: Beat[] = lines.map(l => JSON.parse(l))

// Kinds (ignore the single 'stakes_recalibration' edge-case beat for cross-kind tables)
const KINDS = ["action", "dialogue", "interiority", "description"] as const
const BOOKS = ["crystal_shard", "streams_of_silver", "halflings_gem"]

// ─────────────────────────────────────────────────────────────────────────────
// Shared helpers

function stats(values: number[]): {
  n: number
  mean: number
  median: number
  std: number
  p25: number
  p75: number
  min: number
  max: number
} {
  if (values.length === 0) return { n: 0, mean: 0, median: 0, std: 0, p25: 0, p75: 0, min: 0, max: 0 }
  const sorted = [...values].sort((a, b) => a - b)
  const sum = sorted.reduce((a, b) => a + b, 0)
  const mean = sum / sorted.length
  const variance = sorted.reduce((a, b) => a + (b - mean) ** 2, 0) / sorted.length
  return {
    n: sorted.length,
    mean: Math.round(mean * 100) / 100,
    median: sorted[Math.floor(sorted.length / 2)]!,
    std: Math.round(Math.sqrt(variance) * 100) / 100,
    p25: sorted[Math.floor(sorted.length * 0.25)]!,
    p75: sorted[Math.floor(sorted.length * 0.75)]!,
    min: sorted[0]!,
    max: sorted[sorted.length - 1]!,
  }
}

function splitSentences(text: string): string[] {
  // Same approach as P29: regex on sentence terminators followed by whitespace
  // Then drop empties / whitespace-only fragments.
  return text
    .split(/(?<=[.!?])\s+/)
    .map(s => s.trim())
    .filter(s => s.length > 0)
}

function tokenizeWords(text: string): string[] {
  // Lowercase whitespace-tokenize then strip surrounding punctuation, drop empties.
  return text
    .toLowerCase()
    .split(/\s+/)
    .map(t => t.replace(/^[^a-z']+|[^a-z']+$/g, ""))
    .filter(t => t.length > 0)
}

const ts = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "")

// ─────────────────────────────────────────────────────────────────────────────
// 34a — Sentence length by beat-kind

function runSentenceLengthByKind() {
  const perBook: Record<string, Record<string, ReturnType<typeof stats>>> = {}
  const perBookOverall: Record<string, ReturnType<typeof stats>> = {}
  const perKindAggregate: Record<string, ReturnType<typeof stats>> = {}

  for (const book of BOOKS) {
    perBook[book] = {}
    const bookSents: number[] = []
    for (const kind of KINDS) {
      const sents: number[] = []
      for (const b of beats) {
        if (b.book !== book || b.kind !== kind) continue
        for (const s of splitSentences(b.text)) {
          const wc = tokenizeWords(s).length
          if (wc > 0) sents.push(wc)
        }
      }
      perBook[book]![kind] = stats(sents)
      bookSents.push(...sents)
    }
    perBookOverall[book] = stats(bookSents)
  }

  for (const kind of KINDS) {
    const all: number[] = []
    for (const b of beats) {
      if (b.kind !== kind) continue
      for (const s of splitSentences(b.text)) {
        const wc = tokenizeWords(s).length
        if (wc > 0) all.push(wc)
      }
    }
    perKindAggregate[kind] = stats(all)
  }

  // Per-book ranking of kinds by mean sentence length
  const meanRanksPerBook: Record<string, string[]> = {}
  for (const book of BOOKS) {
    meanRanksPerBook[book] = [...KINDS]
      .map(k => ({ k, mean: perBook[book]![k]!.mean }))
      .sort((a, b) => b.mean - a.mean)
      .map(r => r.k)
  }
  const allRanks = BOOKS.map(b => meanRanksPerBook[b])
  const directionalStable = allRanks.every((r, i) => i === 0 || r!.join(",") === allRanks[0]!.join(","))

  // Action vs description directional: in every book, is action mean shorter than description mean?
  const actionShorterThanDescription = BOOKS.every(
    b => perBook[b]!.action!.mean < perBook[b]!.description!.mean,
  )
  const actionShorterThanDescriptionMargin = Math.round(
    (BOOKS.reduce((acc, b) => acc + (perBook[b]!.description!.mean - perBook[b]!.action!.mean), 0) /
      BOOKS.length) *
      100,
  ) / 100

  const out = {
    pattern: "34a",
    name: "Sentence length by beat-kind",
    computedAt: new Date().toISOString(),
    corpus: "salvatore-icewind-dale",
    books: BOOKS,
    rationale:
      "Extends P29 (whole-corpus sentence-length distribution) with the beat-kind axis. Tests whether action beats actually have shorter sentences than description beats — a craft-canon assumption (Howard, Leonard) that should be empirically verified before encoding it as a writer-prompt prior.",
    methodology: {
      sentence_split: "regex (?<=[.!?])\\s+",
      word_count: "lowercased whitespace-split tokens, surrounding punctuation stripped",
      stats: "n / mean / median / std / p25 / p75 / min / max per-book per-kind",
      directional_gate:
        "(1) does kind-ordering by mean sentence length reproduce across all 3 books, (2) is action mean strictly shorter than description mean in every book?",
    },
    per_book: perBook,
    per_book_overall: perBookOverall,
    per_kind_aggregate: perKindAggregate,
    per_book_kind_ordering_by_mean_sentence_length: meanRanksPerBook,
    directional_stable_ordering: directionalStable,
    action_shorter_than_description_in_every_book: actionShorterThanDescription,
    action_vs_description_mean_gap_words: actionShorterThanDescriptionMargin,
    directional_assessment: directionalStable
      ? `Yes — per-kind sentence-length ordering ${allRanks[0]!.join(" > ")} reproduces across all 3 books.`
      : `Mixed — orderings differ across books: ${BOOKS.map(b => `${b}: ${meanRanksPerBook[b]!.join(" > ")}`).join("; ")}.`,
  }

  const path = `${OUT_DIR}/crystal_shard.${ts}.sentence-length-by-kind.json`
  writeFileSync(path, JSON.stringify(out, null, 2))
  console.log(`wrote ${path}`)
  console.log("\n=== 34a per-book per-kind sentence-length means ===")
  for (const book of BOOKS) {
    const cells = KINDS.map(k => `${k}=${perBook[book]![k]!.mean}w (n=${perBook[book]![k]!.n})`).join(", ")
    console.log(`${book}: ${cells}`)
  }
  console.log(`directional_stable_ordering: ${directionalStable}`)
  console.log(`action<description in all books: ${actionShorterThanDescription} (mean gap = ${actionShorterThanDescriptionMargin}w)`)
  return out
}

// ─────────────────────────────────────────────────────────────────────────────
// 34b — Top-50 action verbs per book
//
// Strategy: extract verbs from action beats by:
//   1. Lowercase + tokenize.
//   2. Tag candidate verb tokens via simple morphology rules:
//      - past simple: -ed
//      - present simple: -s on a stem (3rd person singular) — risky, skip
//      - past participle: -ed (same surface as past simple)
//      - gerund/present participle: -ing
//      - bare/non-conjugated: a known-verb whitelist of ~200 high-frequency English verbs
//        we want to catch (slashed, swung, struck, leapt, etc.)
//   3. Stem to a canonical lemma via a curated mapping for common irregular verbs +
//      morphology rules.
//   4. Remove stop-word verbs (be / have / do / say + auxiliaries).
//   5. Count and report top 50 per book.

const VERB_STOPLIST = new Set([
  // copulas / auxiliaries / extremely high-frequency non-action verbs
  "be", "is", "am", "are", "was", "were", "been", "being",
  "have", "has", "had", "having",
  "do", "does", "did", "done", "doing",
  "say", "says", "said", "saying",
  "go", "goes", "went", "gone", "going",
  "get", "gets", "got", "getting", "gotten",
  "make", "makes", "made", "making",
  "take", "takes", "took", "taken", "taking",
  "give", "gives", "gave", "given", "giving",
  "come", "comes", "came", "coming",
  "see", "sees", "saw", "seen", "seeing",
  "know", "knows", "knew", "known", "knowing",
  "think", "thinks", "thought", "thinking",
  "want", "wants", "wanted", "wanting",
  "use", "uses", "used", "using",
  "find", "finds", "found", "finding",
  "tell", "tells", "told", "telling",
  "ask", "asks", "asked", "asking",
  "work", "works", "worked", "working",
  "seem", "seems", "seemed", "seeming",
  "feel", "feels", "felt", "feeling",
  "try", "tries", "tried", "trying",
  "leave", "leaves", "left", "leaving",
  "call", "calls", "called", "calling",
  // modal-ish
  "can", "could", "will", "would", "shall", "should", "may", "might", "must",
  // ambiguous tokens that surface as verbs but rarely action-verbs in context
  "let", "lets", "letting",
])

// Irregular past/perfect → lemma mapping for verbs likely in action beats
const IRREGULAR_LEMMA: Record<string, string> = {
  // motion / combat
  "ran": "run", "running": "run",
  "swung": "swing", "swinging": "swing",
  "struck": "strike", "stricken": "strike", "striking": "strike",
  "drew": "draw", "drawn": "draw", "drawing": "draw",
  "threw": "throw", "thrown": "throw", "throwing": "throw",
  "sprang": "spring", "sprung": "spring", "springing": "spring",
  "leapt": "leap", "leaped": "leap", "leaping": "leap",
  "fell": "fall", "fallen": "fall", "falling": "fall",
  "rose": "rise", "risen": "rise", "rising": "rise",
  "stood": "stand", "standing": "stand",
  "sat": "sit", "sitting": "sit",
  "lay": "lie", "laid": "lay", "lain": "lie", "lying": "lie",
  "bent": "bend", "bending": "bend",
  "broke": "break", "broken": "break", "breaking": "break",
  "bit": "bite", "bitten": "bite", "biting": "bite",
  "shook": "shake", "shaken": "shake", "shaking": "shake",
  "spun": "spin", "spinning": "spin",
  "flung": "fling", "flinging": "fling",
  "flew": "fly", "flown": "fly", "flying": "fly",
  "dove": "dive", "dived": "dive", "diving": "dive",
  "rode": "ride", "ridden": "ride", "riding": "ride",
  "drove": "drive", "driven": "drive", "driving": "drive",
  "slid": "slide", "sliding": "slide",
  "swept": "sweep", "sweeping": "sweep",
  "swam": "swim", "swum": "swim", "swimming": "swim",
  "crept": "creep", "creeping": "creep",
  "leant": "lean", "leaned": "lean", "leaning": "lean",
  "knelt": "kneel", "kneeling": "kneel",
  "slung": "sling", "slinging": "sling",
  "swore": "swear", "sworn": "swear", "swearing": "swear",
  "tore": "tear", "torn": "tear", "tearing": "tear",
  "shot": "shoot", "shooting": "shoot",
  "hit": "hit", "hitting": "hit",
  "cut": "cut", "cutting": "cut",
  "spread": "spread", "spreading": "spread",
  "split": "split", "splitting": "split",
  "burst": "burst", "bursting": "burst",
  "bled": "bleed", "bleeding": "bleed",
  "led": "lead", "leading": "lead",
  "fled": "flee", "fleeing": "flee",
  "fought": "fight", "fighting": "fight",
  "caught": "catch", "catching": "catch",
  "taught": "teach", "teaching": "teach",
  "brought": "bring", "bringing": "bring",
  "bought": "buy", "buying": "buy",
  "sought": "seek", "seeking": "seek",
  "thought": "think", "thinking": "think",
  "sent": "send", "sending": "send",
  "spent": "spend", "spending": "spend",
  "lent": "lend", "lending": "lend",
  "kept": "keep", "keeping": "keep",
  "slept": "sleep", "sleeping": "sleep",
  "wept": "weep", "weeping": "weep",
  "felt": "feel", "feeling": "feel",
  "dealt": "deal", "dealing": "deal",
  "meant": "mean", "meaning": "mean",
  "held": "hold", "holding": "hold",
  "bound": "bind", "binding": "bind",
  "wound": "wind", "winding": "wind",
  "found": "find", "finding": "find",
  "ground": "grind", "grinding": "grind",
  "wore": "wear", "worn": "wear", "wearing": "wear",
  "bore": "bear", "borne": "bear", "bearing": "bear",
  "dug": "dig", "digging": "dig",
  "hung": "hang", "hanging": "hang",
  "stuck": "stick", "sticking": "stick",
  "struck_through": "strike",  // safety
  "wrung": "wring", "wringing": "wring",
  "rung": "ring", "rang": "ring", "ringing": "ring",
  "sang": "sing", "sung": "sing", "singing": "sing",
  "ate": "eat", "eaten": "eat", "eating": "eat",
  "drank": "drink", "drunk": "drink", "drinking": "drink",
  "began": "begin", "begun": "begin", "beginning": "begin",
  "won": "win", "winning": "win",
  "lost": "lose", "losing": "lose",
  "paid": "pay", "paying": "pay",
  "rode_off": "ride",
  "shut": "shut", "shutting": "shut",
  "set": "set", "setting": "set",
  "put": "put", "putting": "put",
  "let_through": "let",
}

// Lemma whitelist of clearly-verb forms — drives the -e add-back decision in
// lemmatize(): if `stem+e` is in this set we prefer it over `stem`.
const VERB_LEMMA_WHITELIST = new Set([
  "move", "make", "take", "give", "have", "live", "rise", "ride",
  "drive", "shove", "weave", "leave", "love", "shine", "smile", "wave",
  "stare", "glare", "stride", "raise", "place", "race", "chase", "slice",
  "force", "wince", "dance", "glance", "lance", "balance", "advance", "rouse",
  "freeze", "breathe", "writhe", "pause", "praise", "phrase", "ease", "tease",
  "rinse", "sense", "judge", "lodge", "dodge", "edge", "wedge", "merge",
  "charge", "surge", "urge", "scrape", "escape", "shape", "cope", "rope", "tape",
  "type", "wipe", "stripe", "drape", "tape", "pipe", "hope", "scope",
  "amaze", "blaze", "graze", "gaze", "haze", "raze",
  "use", "pose", "close", "lose", "choose", "loose", "rouse", "douse",
  "pulse", "pause", "rinse",
  "cure", "lure", "endure", "ensure", "secure", "share", "scare", "spare",
  "engage", "rage", "stage", "encage", "wage", "manage", "ravage", "savage",
  "image", "damage", "voyage", "salvage", "package",
  "stake", "shake", "sake", "wake", "bake", "lake", "make", "rake", "take",
  "ache", "cache", "ride", "tide", "bide", "abide", "stride", "subside",
  "smile", "while", "file", "pile", "exile", "compile",
  "rule", "rule", "schedule", "tool",
  "decide", "guide", "provide", "side", "reside", "preside", "subside",
  "blame", "fame", "lame", "name", "same", "tame", "frame", "shame",
  "dive", "live", "give", "drive", "thrive", "alive", "arrive", "derive",
  "save", "rave", "wave", "shave", "slave", "stave", "brave", "knave",
  "create", "rate", "fate", "gate", "hate", "late", "mate", "rate", "state",
  "pace", "ace", "brace", "chase", "race", "trace",
  "vote", "note", "wrote", "promote", "denote",
  "dare", "stare", "scare", "share", "spare", "ware",
  "tile", "vile", "while",
  "muse", "amuse",
  "pour", "scour", "devour",
  "scope", "elope", "trope",
  "tope", "wove", "drove",
  "continue", "realize", "recognize", "organize", "minimize", "maximize",
  "ponder", "wander", "render", "consider",
])

// Plural nouns / non-verb tokens that LOOK like -ing/-ed forms after dumb morphology.
// We skip these explicitly. Add new corpus-specific contaminants here.
const NON_VERB_TOKENS = new Set([
  "halfling", "halflings",  // race name in IWD; would lemmatize to "halfl"
  "kindling", "ceiling", "darling", "shilling",  // -ing nouns that aren't verbs
  "bedding", "wedding", "morning", "evening", "warning", // -ing nouns
  "blessing", "feeling",  // act-as-noun in many contexts; "feeling" overlaps with feel verb but is in stoplist
  "spellcasting", "fledgling", "stripling", "yearling",  // fantasy-genre nouns
  "everything", "nothing", "anything", "something",  // pronouns
  "drifting", "lightning", "thing", "things",  // common -ing/thing nouns
])

function lemmatize(token: string): string | null {
  if (token.length < 2) return null
  if (VERB_STOPLIST.has(token)) return null
  if (NON_VERB_TOKENS.has(token)) return null

  const irreg = IRREGULAR_LEMMA[token]
  if (irreg) {
    if (VERB_STOPLIST.has(irreg)) return null
    return irreg
  }

  // Double-consonant English root list (verbs whose lemma already ends in a doubled
  // consonant; the consonant-doubling rule should NOT fire when stripping inflection).
  // Without this guard, "pulled" → "pull" → "pul", "passed" → "pass" → "pas".
  const DOUBLE_CONSONANT_ROOTS = new Set([
    "pull", "pass", "miss", "kiss", "press", "cross", "toss", "hiss", "fuss",
    "fall", "kill", "spill", "still", "yell", "tell", "swell", "smell",
    "fill", "call", "stall", "shall", "wall", "well", "spell", "dwell",
    "roll", "stroll", "scroll", "knell", "drill", "thrill", "trill",
    "bluff", "stuff", "huff", "puff", "sniff", "scoff", "doff",
    "buzz", "fizz", "jazz",
    "add", "egg", "ebb",
  ])

  // -ing → drop, then disambiguate consonant-doubling (running → run vs pulling → pull)
  if (token.endsWith("ing") && token.length > 4) {
    const baseStem = token.slice(0, -3)
    // First check whether the bare stem is itself a known double-consonant root
    // (pulling → pull, passing → pass).
    if (DOUBLE_CONSONANT_ROOTS.has(baseStem)) {
      if (VERB_STOPLIST.has(baseStem)) return null
      return baseStem
    }
    let stem = baseStem
    if (stem.length >= 3 && stem[stem.length - 1] === stem[stem.length - 2] && /[bcdfghjklmnpqrstvwxz]/.test(stem[stem.length - 1]!)) {
      stem = stem.slice(0, -1)
    }
    const stemPlusE = stem + "e"
    if (VERB_STOPLIST.has(stem) || VERB_STOPLIST.has(stemPlusE)) return null
    // Prefer stem+e if it's a recognized verb lemma (making → make, riding → ride,
    // moving → move). Otherwise fall back to bare stem (running → run).
    if (VERB_LEMMA_WHITELIST.has(stemPlusE)) return stemPlusE
    return stem
  }

  // -ed → drop, also handle double-consonant (stopped → stop), -ied → -y (carried → carry)
  if (token.endsWith("ied") && token.length > 4) {
    const lemma = token.slice(0, -3) + "y"
    if (VERB_STOPLIST.has(lemma)) return null
    return lemma
  }
  if (token.endsWith("ed") && token.length > 3) {
    const baseStem = token.slice(0, -2)
    if (DOUBLE_CONSONANT_ROOTS.has(baseStem)) {
      if (VERB_STOPLIST.has(baseStem)) return null
      return baseStem
    }
    let stem = baseStem
    if (stem.length >= 3 && stem[stem.length - 1] === stem[stem.length - 2] && /[bcdfghjklmnpqrstvwxz]/.test(stem[stem.length - 1]!)) {
      stem = stem.slice(0, -1)
    }
    const stemPlusE = stem + "e"
    if (VERB_STOPLIST.has(stem) || VERB_STOPLIST.has(stemPlusE)) return null
    if (VERB_LEMMA_WHITELIST.has(stemPlusE)) return stemPlusE
    return stem
  }

  // bare form / 3rd-person -s — skip without context: too noisy (could be plural noun)
  // Only allow if the token is in a small whitelist of clearly-verb bare forms in action prose
  return null
}

const ACTION_VERB_WHITELIST_BARE = new Set([
  "draw", "drew", "drawn", "swing", "strike", "throw", "leap",
  "spin", "spun", "fight", "block", "parry", "thrust", "slash", "stab", "smash",
  "crash", "kill", "die", "fall", "fell", "rise", "rose", "duck", "dodge", "lunge",
  "shoot", "fire", "wound", "bleed", "scream", "yell", "shout", "growl", "roar", "snarl",
  "charge", "rush", "burst", "shatter", "crush", "grip", "grab", "snatch", "hurl",
  "pull", "push", "shove", "punch", "kick", "trip", "stumble", "tumble", "spring",
  "race", "sprint", "dash", "flee", "chase", "follow", "pursue", "track", "stalk",
])

function runActionVerbLexicon() {
  const perBookCounts: Record<string, Map<string, number>> = {}
  const perBookActionWords: Record<string, number> = {}

  for (const book of BOOKS) {
    const counts = new Map<string, number>()
    let actionWords = 0
    for (const b of beats) {
      if (b.book !== book || b.kind !== "action") continue
      const tokens = tokenizeWords(b.text)
      actionWords += tokens.length
      for (const tok of tokens) {
        const lemma = lemmatize(tok)
        if (!lemma) continue
        if (lemma.length < 3) continue
        if (VERB_STOPLIST.has(lemma)) continue
        counts.set(lemma, (counts.get(lemma) ?? 0) + 1)
      }
    }
    perBookCounts[book] = counts
    perBookActionWords[book] = actionWords
  }

  // Compute top-50 per book + cross-book overlap signature
  const top50: Record<string, Array<{ verb: string; count: number; per_1000_action_words: number }>> = {}
  for (const book of BOOKS) {
    const sorted = [...perBookCounts[book]!.entries()].sort((a, b) => b[1] - a[1]).slice(0, 50)
    top50[book] = sorted.map(([verb, count]) => ({
      verb,
      count,
      per_1000_action_words: Math.round((count / perBookActionWords[book]!) * 1000 * 100) / 100,
    }))
  }

  // Cross-book signature: verbs in all 3 top-50s
  const set1 = new Set(top50.crystal_shard!.map(e => e.verb))
  const set2 = new Set(top50.streams_of_silver!.map(e => e.verb))
  const set3 = new Set(top50.halflings_gem!.map(e => e.verb))
  const allThree = [...set1].filter(v => set2.has(v) && set3.has(v))
  const exactlyTwo = [...set1, ...set2, ...set3].filter((v, i, arr) => arr.indexOf(v) === i).filter(v => {
    const inCount = (set1.has(v) ? 1 : 0) + (set2.has(v) ? 1 : 0) + (set3.has(v) ? 1 : 0)
    return inCount === 2
  })

  // For the cross-book set, compute mean rank
  const meanRankByVerb: Array<{ verb: string; mean_rank: number; cs_count: number; sos_count: number; hg_count: number }> = []
  for (const verb of allThree) {
    const cs = top50.crystal_shard!.find(e => e.verb === verb)!
    const sos = top50.streams_of_silver!.find(e => e.verb === verb)!
    const hg = top50.halflings_gem!.find(e => e.verb === verb)!
    const csRank = top50.crystal_shard!.indexOf(cs) + 1
    const sosRank = top50.streams_of_silver!.indexOf(sos) + 1
    const hgRank = top50.halflings_gem!.indexOf(hg) + 1
    meanRankByVerb.push({
      verb,
      mean_rank: Math.round(((csRank + sosRank + hgRank) / 3) * 100) / 100,
      cs_count: cs.count,
      sos_count: sos.count,
      hg_count: hg.count,
    })
  }
  meanRankByVerb.sort((a, b) => a.mean_rank - b.mean_rank)

  const out = {
    pattern: "34b",
    name: "Top-50 action verbs per book — Salvatore action verb signature",
    computedAt: new Date().toISOString(),
    corpus: "salvatore-icewind-dale",
    books: BOOKS,
    rationale:
      "Identifies the recurring action-verb lexicon Salvatore uses inside action beats. Verbs appearing in all 3 books' top-50 form the 'Salvatore action signature' — a candidate writer-prompt few-shot lexicon for fantasy combat scenes. Pure compute; complements the LoRA voice fine-tune by giving the prompt-level layer a directional verb prior.",
    methodology: {
      scope: "Beats with kind='action' only.",
      tokenize: "Lowercase whitespace-split, surrounding punctuation stripped.",
      lemmatize:
        "Curated irregular-verb table covers ~120 high-frequency motion/combat verbs; -ing/-ed morphology rules with double-consonant + -ied→-y handling; stoplist removes copulas/auxiliaries/extremely-high-frequency reporting verbs (say/think/know/feel/etc.). Bare forms and -s 3rd-person are not counted (too ambiguous noun/verb without POS-tagger).",
      caveats:
        "Conservative recall — bare-form verbs are skipped to avoid noun contamination. Counts therefore underestimate; rank-order across the recovered subset is the trustworthy signal.",
    },
    per_book_action_word_total: perBookActionWords,
    top_50_per_book: top50,
    cross_book_signature_in_all_three_top_50: meanRankByVerb,
    cross_book_signature_count: meanRankByVerb.length,
    in_exactly_two_top_50: exactlyTwo,
  }

  const path = `${OUT_DIR}/crystal_shard.${ts}.action-verb-lexicon.json`
  writeFileSync(path, JSON.stringify(out, null, 2))
  console.log(`\nwrote ${path}`)
  console.log(`=== 34b cross-book top-50 signature size: ${meanRankByVerb.length} verbs ===`)
  console.log(meanRankByVerb.slice(0, 25).map(v => `${v.verb} (${v.cs_count}/${v.sos_count}/${v.hg_count})`).join(", "))
  return out
}

// ─────────────────────────────────────────────────────────────────────────────
// 34c — Adverb density (-ly suffix) per 100 words

const LY_NON_ADVERB_BLOCKLIST = new Set([
  // common -ly words that are NOT adverbs
  "only", "really", "actually",  // these ARE adverbs but we keep them; not in blocklist
])
// Words ending in -ly that are NOT manner adverbs (we exclude the most common false-positives).
// Three classes:
//   (a) common nouns (reply, ally, family, July),
//   (b) adjectives ending in -ly (lovely, lonely, manly, deadly),
//   (c) proper nouns (Kelly, Molly).
// Genuine adverbs ("only", "really", "actually") are NOT in this list.
const LY_FALSE_POSITIVES = new Set([
  // common nouns
  "july", "lily", "rally", "ally", "alley", "belly", "billy", "bully", "dally",
  "doily", "dolly", "family", "filly", "folly", "gally", "gully",
  "holly", "italy", "jelly", "kelly", "molly", "nelly", "polly", "rally",
  "silly", "sully", "tally", "tilly", "wally", "willy", "woolly",
  "reply", "supply", "apply", "imply", "comply",
  "anomaly", "monopoly", "remedy", "comedy", "tragedy",  // not -ly but defensive
  // -ly adjectives that are NOT typically used as adverbs.
  // Borderline cases ("deadly," "kindly," "wholly") DO function adverbially in
  // narrative prose so we keep them in the count. Only words that are
  // overwhelmingly adjectival in fantasy prose are blocked.
  "homely", "hurly", "jolly", "lonely", "lovely", "lowly", "manly",
  "ugly", "godly", "bodily", "costly", "kingly", "knightly", "lordly", "miserly",
  "scaly", "scholarly", "shapely", "sickly", "stately", "surly",
  "ungainly", "wily", "worldly",
  // Salvatore-specific
  "shimmergloom", // not -ly but defensive
])

function runAdverbDensity() {
  const perBook: Record<string, { total_words: number; ly_count: number; per_100_words: number; per_1000_words: number; top_adverbs: Array<{ adverb: string; count: number }> }> = {}
  const perBookKind: Record<string, Record<string, { words: number; ly_count: number; per_100_words: number }>> = {}

  for (const book of BOOKS) {
    let totalWords = 0
    let lyCount = 0
    const adverbCounts = new Map<string, number>()
    perBookKind[book] = {}
    for (const kind of KINDS) {
      perBookKind[book]![kind] = { words: 0, ly_count: 0, per_100_words: 0 }
    }

    for (const b of beats) {
      if (b.book !== book) continue
      const tokens = tokenizeWords(b.text)
      totalWords += tokens.length
      let beatLyCount = 0
      for (const tok of tokens) {
        if (tok.length < 4) continue
        if (!tok.endsWith("ly")) continue
        if (LY_FALSE_POSITIVES.has(tok)) continue
        // Heuristic: real -ly adverbs have a vowel before the -ly more often than not,
        // but "only", "fully", etc. are real adverbs and we keep them.
        adverbCounts.set(tok, (adverbCounts.get(tok) ?? 0) + 1)
        lyCount++
        beatLyCount++
      }
      if (KINDS.includes(b.kind as any)) {
        perBookKind[book]![b.kind]!.words += tokens.length
        perBookKind[book]![b.kind]!.ly_count += beatLyCount
      }
    }

    for (const kind of KINDS) {
      const cell = perBookKind[book]![kind]!
      cell.per_100_words = cell.words === 0 ? 0 : Math.round((cell.ly_count / cell.words) * 10000) / 100
    }

    const top = [...adverbCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 25)
      .map(([adverb, count]) => ({ adverb, count }))

    perBook[book] = {
      total_words: totalWords,
      ly_count: lyCount,
      per_100_words: Math.round((lyCount / totalWords) * 10000) / 100,
      per_1000_words: Math.round((lyCount / totalWords) * 1000000) / 100,
      top_adverbs: top,
    }
  }

  // Howard's principle: minimize adverbs. Reference rate to compare against:
  //   - Hemingway: ~1.5 / 100w
  //   - Howard: ~2.0–2.5 / 100w
  //   - Stephen King in non-fiction recommends well under 3 / 100w
  // We just report the rate; no pass/fail gate.

  const meanRate = Math.round(
    (BOOKS.reduce((acc, b) => acc + perBook[b]!.per_100_words, 0) / BOOKS.length) * 100,
  ) / 100
  const minRate = Math.min(...BOOKS.map(b => perBook[b]!.per_100_words))
  const maxRate = Math.max(...BOOKS.map(b => perBook[b]!.per_100_words))

  const out = {
    pattern: "34c",
    name: "Adverb density (-ly suffix) per 100 words",
    computedAt: new Date().toISOString(),
    corpus: "salvatore-icewind-dale",
    books: BOOKS,
    rationale:
      "Howard's craft principle says to minimize adverbs in prose; modern style guides (King, Leonard) echo. Tests Salvatore's actual rate and whether action vs description differ — informs the lint layer (deterministic adverb-density warning) and writer-prompt voice priors.",
    methodology: {
      detection: "regex /[a-z]{2,}ly$/ on lowercased whitespace tokens",
      false_positive_filter: `${LY_FALSE_POSITIVES.size}-word blocklist of common -ly words that are NOT manner adverbs (place names, proper nouns, family/lily/lovely/etc.). Note this is conservative — most surfaced tokens ending in -ly in narrative prose are genuine adverbs.`,
      caveats:
        "Does not catch non-ly adverbs (very, quite, often, never). Reports manner-adverb rate as a lower bound on total adverb density. Reference baseline: Hemingway ~1.5/100w, Howard ~2.0–2.5/100w.",
    },
    per_book: perBook,
    per_book_per_kind: perBookKind,
    cross_book_summary: {
      mean_per_100_words: meanRate,
      range: [minRate, maxRate],
      directional: minRate >= 1.0 && maxRate <= 4.0
        ? `All three books fall in 1.0–4.0/100w range — typical commercial-fantasy adverb rate. Salvatore is not aggressively pruning adverbs the Howard way.`
        : `Range exceeds typical 1.0–4.0/100w envelope.`,
    },
  }

  const path = `${OUT_DIR}/crystal_shard.${ts}.adverb-density.json`
  writeFileSync(path, JSON.stringify(out, null, 2))
  console.log(`\nwrote ${path}`)
  console.log(`=== 34c per-book adverb rate (-ly per 100w) ===`)
  for (const book of BOOKS) {
    console.log(`${book}: ${perBook[book]!.per_100_words}/100w (${perBook[book]!.ly_count} -ly tokens / ${perBook[book]!.total_words}w)`)
  }
  return out
}

// ─────────────────────────────────────────────────────────────────────────────
// 34d — Interiority marker density

const INTERIORITY_MARKERS = [
  "thought", "thoughts", "thinking",
  "felt", "feels", "feeling", "feelings",
  "wondered", "wonders", "wondering", "wonder",
  "knew", "knows", "knowing",
  "realized", "realizes", "realizing", "realization",
  "considered", "considers", "considering", "consideration",
  "remembered", "remembers", "remembering", "memory",
  "understood", "understands", "understanding",
  "doubted", "doubts", "doubting", "doubt",
  "believed", "believes", "believing", "belief",
  "decided", "decides", "deciding", "decision",
  "hoped", "hopes", "hoping", "hope",
  "feared", "fears", "fearing", "fear",
  "imagined", "imagines", "imagining", "imagination",
  "recalled", "recalls", "recalling",
  "noticed", "notices", "noticing",
  "sensed", "senses", "sensing",
  "suspected", "suspects", "suspecting", "suspicion",
  "guessed", "guesses", "guessing",
  "judged", "judges", "judging", "judgment",
  "concluded", "concludes", "concluding",
  "reasoned", "reasons", "reasoning",
  "pondered", "ponders", "pondering",
  "mused", "muses", "musing",
  "reflected", "reflects", "reflecting", "reflection",
]
const INTERIORITY_SET = new Set(INTERIORITY_MARKERS)

function runInteriorityMarkerDensity() {
  const perBookKind: Record<string, Record<string, { words: number; markers: number; per_100_words: number }>> = {}
  const perBookOverall: Record<string, { words: number; markers: number; per_100_words: number }> = {}
  // Per-book per-kind per-marker breakdown for top markers
  const markerBreakdown: Record<string, Record<string, Map<string, number>>> = {}

  for (const book of BOOKS) {
    perBookKind[book] = {}
    markerBreakdown[book] = {}
    let bookWords = 0
    let bookMarkers = 0
    for (const kind of KINDS) {
      perBookKind[book]![kind] = { words: 0, markers: 0, per_100_words: 0 }
      markerBreakdown[book]![kind] = new Map()
    }
    for (const b of beats) {
      if (b.book !== book) continue
      const tokens = tokenizeWords(b.text)
      bookWords += tokens.length
      let beatMarkers = 0
      const localBreak = new Map<string, number>()
      for (const tok of tokens) {
        if (INTERIORITY_SET.has(tok)) {
          beatMarkers++
          localBreak.set(tok, (localBreak.get(tok) ?? 0) + 1)
        }
      }
      bookMarkers += beatMarkers
      if (KINDS.includes(b.kind as any)) {
        perBookKind[book]![b.kind]!.words += tokens.length
        perBookKind[book]![b.kind]!.markers += beatMarkers
        for (const [k, v] of localBreak) {
          markerBreakdown[book]![b.kind]!.set(k, (markerBreakdown[book]![b.kind]!.get(k) ?? 0) + v)
        }
      }
    }
    for (const kind of KINDS) {
      const cell = perBookKind[book]![kind]!
      cell.per_100_words = cell.words === 0 ? 0 : Math.round((cell.markers / cell.words) * 10000) / 100
    }
    perBookOverall[book] = {
      words: bookWords,
      markers: bookMarkers,
      per_100_words: Math.round((bookMarkers / bookWords) * 10000) / 100,
    }
  }

  // Per-kind aggregate (across books)
  const perKindAggregate: Record<string, { words: number; markers: number; per_100_words: number }> = {}
  for (const kind of KINDS) {
    let words = 0
    let markers = 0
    for (const book of BOOKS) {
      words += perBookKind[book]![kind]!.words
      markers += perBookKind[book]![kind]!.markers
    }
    perKindAggregate[kind] = {
      words,
      markers,
      per_100_words: words === 0 ? 0 : Math.round((markers / words) * 10000) / 100,
    }
  }

  // Per-book ranking: which kind is densest in interiority markers?
  const kindRankByDensityPerBook: Record<string, string[]> = {}
  for (const book of BOOKS) {
    kindRankByDensityPerBook[book] = [...KINDS]
      .map(k => ({ k, rate: perBookKind[book]![k]!.per_100_words }))
      .sort((a, b) => b.rate - a.rate)
      .map(r => r.k)
  }
  const allRanks = BOOKS.map(b => kindRankByDensityPerBook[b])
  const directionalStable = allRanks.every((r, i) => i === 0 || r!.join(",") === allRanks[0]!.join(","))
  const interiorityKindIsDensestEverywhere = BOOKS.every(b => kindRankByDensityPerBook[b]![0] === "interiority")

  // Top markers cross-book
  const topMarkersPerBook: Record<string, Array<{ marker: string; count: number }>> = {}
  for (const book of BOOKS) {
    const totals = new Map<string, number>()
    for (const kind of KINDS) {
      for (const [k, v] of markerBreakdown[book]![kind]!) {
        totals.set(k, (totals.get(k) ?? 0) + v)
      }
    }
    topMarkersPerBook[book] = [...totals.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .map(([marker, count]) => ({ marker, count }))
  }

  const out = {
    pattern: "34d",
    name: "Interiority marker density per book and per beat-kind",
    computedAt: new Date().toISOString(),
    corpus: "salvatore-icewind-dale",
    books: BOOKS,
    rationale:
      "Tests whether interiority-tagged beats are actually densest in reflective markers (thought/felt/wondered/knew/realized/considered/etc.) or whether interiority is structurally diffused across all beat kinds. Informs (a) whether the 'interiority' beat-kind label maps to a real prose signal, (b) whether the writer should be prompted to insert these markers into action/description beats too.",
    methodology: {
      marker_set: `${INTERIORITY_MARKERS.length}-word curated marker lexicon: ${INTERIORITY_MARKERS.slice(0, 10).join(", ")}, ...`,
      detection: "Exact lowercased whitespace-token match (no stemming).",
      density: "markers / words × 100 → markers per 100 words.",
      caveats:
        "Excludes free indirect interiority that doesn't surface a marker word ('It was hopeless,' 'The orcs would come,' etc. — implicit thought without verb of cognition). Real interiority density is higher than the marker rate; this measures the explicit-marker layer only.",
  },
    per_book_overall: perBookOverall,
    per_book_per_kind: perBookKind,
    per_kind_aggregate_across_books: perKindAggregate,
    per_book_kind_ranking_by_marker_density: kindRankByDensityPerBook,
    directional_stable_ranking: directionalStable,
    interiority_kind_densest_in_every_book: interiorityKindIsDensestEverywhere,
    directional_assessment: directionalStable
      ? `Yes — kind-ranking by interiority-marker density (${allRanks[0]!.join(" > ")}) reproduces across all 3 books. Interiority kind ${interiorityKindIsDensestEverywhere ? "is" : "is NOT"} the densest beat-kind in every book.`
      : `Mixed — orderings differ across books: ${BOOKS.map(b => `${b}: ${kindRankByDensityPerBook[b]!.join(" > ")}`).join("; ")}.`,
    top_15_markers_per_book: topMarkersPerBook,
  }

  const path = `${OUT_DIR}/crystal_shard.${ts}.interiority-marker-density.json`
  writeFileSync(path, JSON.stringify(out, null, 2))
  console.log(`\nwrote ${path}`)
  console.log(`=== 34d per-book overall interiority-marker rate ===`)
  for (const book of BOOKS) {
    console.log(`${book}: ${perBookOverall[book]!.per_100_words}/100w  (${perBookOverall[book]!.markers} markers / ${perBookOverall[book]!.words}w)`)
  }
  console.log(`\n=== 34d per-book ranking by kind ===`)
  for (const book of BOOKS) {
    const cells = KINDS.map(k => `${k}=${perBookKind[book]![k]!.per_100_words}/100w`).join(", ")
    console.log(`${book}: ${cells}`)
  }
  console.log(`directional_stable_ranking: ${directionalStable}, interiority kind densest everywhere: ${interiorityKindIsDensestEverywhere}`)
  return out
}

// ─────────────────────────────────────────────────────────────────────────────
// Run all four

console.log(`Pattern 34 bundle — sentence rhythm + lexicon analyses (TS=${ts})`)
console.log(`Total beats: ${beats.length}`)
const r34a = runSentenceLengthByKind()
const r34b = runActionVerbLexicon()
const r34c = runAdverbDensity()
const r34d = runInteriorityMarkerDensity()

console.log("\n=== bundle done ===")
