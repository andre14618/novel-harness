import type { SeedInput, CharacterSketch } from "./types"
import * as readline from "node:readline"

// Auto mode — skips all human gates
export let autoMode = false
export function setAutoMode(enabled: boolean): void {
  autoMode = enabled
}

let rl: readline.Interface | null = null

function getRL(): readline.Interface {
  if (!rl) {
    rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  }
  return rl
}

function ask(question: string): Promise<string> {
  return new Promise(resolve => {
    getRL().question(question, answer => resolve(answer.trim()))
  })
}

export function closeInput(): void {
  if (rl) rl.close()
}

export async function collectSeedInput(): Promise<SeedInput> {
  console.log("\n╔══════════════════════════════════════╗")
  console.log("║       NOVEL HARNESS — New Novel      ║")
  console.log("╚══════════════════════════════════════╝\n")

  const premise = await ask("Premise (1-3 sentences):\n> ")
  const genre = await ask("\nGenre (e.g. 'sci-fi thriller', 'epic fantasy'):\n> ")

  const charCountStr = await ask("\nHow many main characters? (2-4): ")
  const charCount = Math.min(4, Math.max(2, parseInt(charCountStr) || 3))

  const characters: CharacterSketch[] = []
  for (let i = 0; i < charCount; i++) {
    console.log(`\n--- Character ${i + 1} ---`)
    const name = await ask("Name: ")
    const roleStr = await ask("Role (protagonist/antagonist/supporting): ")
    const role = (["protagonist", "antagonist", "supporting"].includes(roleStr)
      ? roleStr
      : "supporting") as CharacterSketch["role"]
    const description = await ask("Brief description (2-3 sentences):\n> ")
    characters.push({ name, role, description })
  }

  return { premise, genre, characters }
}

export async function presentForApproval(title: string, content: string): Promise<"approve" | "revise" | "reject"> {
  console.log(`\n${"─".repeat(60)}`)
  console.log(`  ${title}`)
  console.log("─".repeat(60))

  // Show content, truncated if very long
  const lines = content.split("\n")
  if (lines.length > 80) {
    console.log(lines.slice(0, 60).join("\n"))
    console.log(`\n... (${lines.length - 60} more lines) ...\n`)
    console.log(lines.slice(-10).join("\n"))
  } else {
    console.log(content)
  }

  console.log("\n" + "─".repeat(60))

  if (autoMode) {
    console.log("  [AUTO] Approved")
    return "approve"
  }

  while (true) {
    const answer = await ask("[a]pprove / [r]evise / re[j]ect? ")
    const lower = answer.toLowerCase()
    if (lower === "a" || lower === "approve") return "approve"
    if (lower === "r" || lower === "revise") return "revise"
    if (lower === "j" || lower === "reject") return "reject"
    console.log("  Please enter 'a', 'r', or 'j'")
  }
}

export async function getRevisionNotes(): Promise<string[]> {
  if (autoMode) return []
  console.log("\nEnter revision notes (one per line, empty line to finish):")
  const notes: string[] = []
  while (true) {
    const note = await ask("> ")
    if (!note) break
    notes.push(note)
  }
  return notes
}

export function displayPhaseHeader(phase: string): void {
  console.log(`\n${"═".repeat(60)}`)
  console.log(`  PHASE: ${phase.toUpperCase()}`)
  console.log("═".repeat(60))
}

export function displayProgress(current: number, total: number, label: string): void {
  const pct = Math.round((current / total) * 100)
  const filled = Math.round(pct / 5)
  const bar = "█".repeat(filled) + "░".repeat(20 - filled)
  console.log(`  [${bar}] ${pct}% — ${label}`)
}

export function formatWorldBible(wb: any): string {
  let out = `Setting: ${wb.setting}\n`
  out += `Time Period: ${wb.timePeriod}\n`
  out += `Culture: ${wb.culture}\n`
  out += `History: ${wb.history}\n`
  out += `\nRules:\n${wb.rules.map((r: string) => `  - ${r}`).join("\n")}`
  out += `\n\nLocations:\n${wb.locations.map((l: any) => `  - ${l.name}: ${l.description}`).join("\n")}`
  return out
}

export function formatCharacterProfiles(chars: any[]): string {
  return chars.map(c => {
    let out = `[${c.role}] ${c.name}\n`
    out += `  Backstory: ${c.backstory}\n`
    out += `  Traits: ${c.traits.join(", ")}\n`
    out += `  Speech: ${c.speechPattern}\n`
    out += `  Goals: ${c.goals}\n`
    out += `  Fears: ${c.fears}\n`
    if (c.relationships.length > 0) {
      out += `  Relationships:\n${c.relationships.map((r: any) => `    - ${r.characterName}: ${r.nature}`).join("\n")}`
    }
    return out
  }).join("\n\n")
}

export function formatStorySpine(spine: any): string {
  let out = `Central Conflict: ${spine.centralConflict}\n`
  out += `Theme: ${spine.theme}\n`
  out += `Ending Direction: ${spine.endingDirection}\n\n`
  out += `Acts:\n${spine.acts.map((a: any) =>
    `  Act ${a.number}: ${a.name}\n    ${a.summary}\n    Emotional arc: ${a.emotionalArc}`
  ).join("\n\n")}`
  return out
}

export function formatChapterOutlines(outlines: any[]): string {
  return outlines.map(o => {
    let out = `Chapter ${o.chapterNumber}: ${o.title}\n`
    out += `  POV: ${o.povCharacter} | Setting: ${o.setting}\n`
    out += `  Purpose: ${o.purpose}\n`
    out += `  Target: ~${o.targetWords} words\n`
    out += `  Characters: ${o.charactersPresent.join(", ")}\n`
    out += `  Scenes:\n${o.scenes.map((s: any, i: number) =>
      `    ${i + 1}. ${s.description} [${s.emotionalShift}]`
    ).join("\n")}`
    return out
  }).join("\n\n")
}
