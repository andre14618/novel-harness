/**
 * Merge 800-beat bundle + 10 label files into SFT training JSONL.
 * Format matches adherence-checker-v4 recipe: system + user + assistant messages.
 *
 * Output: finetune-data/halluc-checker-v1-{train,val}.jsonl
 * Stratified 80/20 split by (writer, pass/fail).
 */
import { readFileSync, writeFileSync, mkdirSync } from "fs"

const SYSTEM_PROMPT = `You are a hallucination detector for generated fiction beats.

Given a beat's prose, brief, world bible excerpt, and speaker profiles, identify named entities in the prose that are NOT grounded in the supplied context.

Flag two categories:
A. Corpus leakage — names borrowed from R.A. Salvatore's Icewind Dale / Forgotten Realms (Drizzt, Bruenor, Mithril Hall, Ten-Towns, Bryn Shander, Termalaine, Calimport, Luskan, Maer Dualdon, Cryshal-Tirith, Harpells, Sword Coast, Faerûn, Crystal Shard, Aegis-fang, drow, verbeeg, duergar, Do'Urden, Battlehammer, Baldur's Gate, etc.).
B. Ungrounded named entities — proper nouns (characters, places, items, factions, systems) that do not appear in speakers, brief.characters, brief.setting, brief.pov, or world_bible_excerpt.

Pass (do not flag): sentence-initial common nouns, days/months, real-world refs, generic titles ("the Captain"), cardinal coordinates, last-name aliases of grounded characters, title+grounded-surname aliases, lowercase generic race terms.

Edge rules: first+new-last-name → FAIL (drift); new named character in dialogue only → FAIL; plural ungrounded faction → FAIL; brief.summary counts as grounded context.

Output ONLY valid JSON:
{"pass": bool, "issues": [{"entity": "...", "excerpt": "..."}]}

Empty issues array if pass. excerpt is a 10-30 word context span.`

interface BundleBeat {
  id: number
  writer: "v4" | "ds"
  prose: string
  brief: any
  world_bible_excerpt: any
  speakers: any
}

interface Label {
  id: number
  pass: boolean
  issues: Array<{ entity: string; excerpt: string }>
}

function buildUserPrompt(b: BundleBeat): string {
  const speakers = Object.entries(b.speakers).map(([name, p]: [string, any]) =>
    `  ${name}: ${p.speechPattern || "(no profile)"}`
  ).join("\n") || "  (none)"

  const locs = (b.world_bible_excerpt.locations ?? []).map((l: any) => l.name).join(", ") || "(none)"
  const cultures = (b.world_bible_excerpt.cultures ?? []).map((c: any) => c.name).join(", ") || "(none)"
  const systems = (b.world_bible_excerpt.world_systems ?? []).map((s: any) => s.name).join(", ") || "(none)"

  return `BEAT BRIEF:
Summary: ${b.brief.summary}
Kind: ${b.brief.kind}
POV: ${b.brief.pov}
Setting: ${b.brief.setting}
Characters: ${(b.brief.characters ?? []).join(", ") || "(none)"}

WORLD BIBLE (relevant):
Locations: ${locs}
Cultures: ${cultures}
Systems: ${systems}

SPEAKERS:
${speakers}

PROSE TO CHECK:
${b.prose}`
}

function main() {
  // Load all bundle beats
  const bundle: BundleBeat[] = []
  for (let i = 0; i < 10; i++) {
    bundle.push(...JSON.parse(readFileSync(`/tmp/halluc-fresh-batch-${i}.json`, "utf8")))
  }

  // Load all labels, indexed by id
  const labels = new Map<number, Label>()
  for (let i = 0; i < 10; i++) {
    for (const l of JSON.parse(readFileSync(`/tmp/halluc-fresh-labels-${i}.json`, "utf8")) as Label[]) {
      labels.set(l.id, l)
    }
  }

  // Build SFT rows
  const rows: Array<{ messages: any[]; _meta: any }> = []
  for (const b of bundle) {
    const label = labels.get(b.id)
    if (!label) continue
    const user = buildUserPrompt(b)
    const assistant = JSON.stringify({ pass: label.pass, issues: label.issues ?? [] })
    rows.push({
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: user },
        { role: "assistant", content: assistant },
      ],
      _meta: { id: b.id, writer: b.writer, pass: label.pass, novel_id: (b as any).novel_id },
    })
  }

  console.log(`Built ${rows.length} SFT rows from ${bundle.length} bundle beats`)

  // Stratified 80/20 split by (writer, pass)
  const buckets: Record<string, typeof rows> = {}
  for (const r of rows) {
    const k = `${r._meta.writer}:${r._meta.pass ? "pass" : "fail"}`
    ;(buckets[k] ??= []).push(r)
  }
  const train: typeof rows = []
  const val: typeof rows = []
  const rng = (seed: number) => { let s = seed; return () => (s = (s * 9301 + 49297) % 233280) / 233280 }
  const rand = rng(42)
  for (const [k, bucket] of Object.entries(buckets)) {
    const shuffled = bucket.slice().sort(() => rand() - 0.5)
    const valSize = Math.round(shuffled.length * 0.2)
    val.push(...shuffled.slice(0, valSize))
    train.push(...shuffled.slice(valSize))
    console.log(`  ${k}: ${bucket.length} total → ${shuffled.length - valSize} train / ${valSize} val`)
  }

  mkdirSync("finetune-data", { recursive: true })
  writeFileSync("finetune-data/halluc-checker-v1-train.jsonl",
    train.map(r => JSON.stringify({ messages: r.messages, _meta: r._meta })).join("\n") + "\n")
  writeFileSync("finetune-data/halluc-checker-v1-val.jsonl",
    val.map(r => JSON.stringify({ messages: r.messages, _meta: r._meta })).join("\n") + "\n")

  console.log(`\nTrain: ${train.length} rows → finetune-data/halluc-checker-v1-train.jsonl`)
  console.log(`Val: ${val.length} rows → finetune-data/halluc-checker-v1-val.jsonl`)
}

main()
