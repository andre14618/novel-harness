import type { SeedInput, CharacterSketch } from "./types"
import * as readline from "node:readline"
import * as gates from "./gates"
import type { GateDecision, GateResolverMode } from "./gates"

// Auto mode — skips all human gates
export let autoMode = false
export function setAutoMode(enabled: boolean): void {
  autoMode = enabled
}

// Resolver mode — set once at startup
let resolverMode: GateResolverMode = "cli"
export function setResolverMode(mode: GateResolverMode): void {
  resolverMode = mode
}
export function getResolverMode(): GateResolverMode {
  return resolverMode
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

/**
 * Present content for human approval. Uses the gate system —
 * in CLI mode, also pumps readline to resolve the gate.
 * In web mode, waits for the API to resolve it.
 * In auto mode, approves immediately.
 */
export async function presentForApproval(
  novelId: string,
  gateId: string,
  title: string,
  content: string,
): Promise<"approve" | "revise" | "reject"> {
  // Always log to console (visible in process stdout for web mode too)
  console.log(`\n${"─".repeat(60)}`)
  console.log(`  ${title}`)
  console.log("─".repeat(60))

  const lines = content.split("\n")
  if (lines.length > 80) {
    console.log(lines.slice(0, 60).join("\n"))
    console.log(`\n... (${lines.length - 60} more lines) ...\n`)
    console.log(lines.slice(-10).join("\n"))
  } else {
    console.log(content)
  }

  console.log("\n" + "─".repeat(60))

  if (resolverMode === "auto") {
    console.log("  [AUTO] Approved")
    return "approve"
  }

  // Create gate request
  const gatePromise = gates.request(novelId, gateId, title, content, resolverMode)

  if (resolverMode === "cli") {
    // In CLI mode, also start readline to resolve the gate
    const cliPromise = (async (): Promise<GateDecision> => {
      while (true) {
        const answer = await ask("[a]pprove / [r]evise / re[j]ect? ")
        const lower = answer.toLowerCase()
        if (lower === "a" || lower === "approve") return { action: "approve" }
        if (lower === "r" || lower === "revise") return { action: "revise" }
        if (lower === "j" || lower === "reject") return { action: "reject" }
        console.log("  Please enter 'a', 'r', or 'j'")
      }
    })()

    // Race: either CLI input or web API resolves the gate
    const decision = await Promise.race([gatePromise, cliPromise])

    // If CLI won, resolve the gate so web clients get notified
    if (gates.getPending(novelId)) {
      gates.resolve(novelId, gateId, decision)
    }

    return decision.action
  }

  // Web mode — just wait for the API to resolve it
  console.log("  [WAITING] Approval pending in web UI...")
  const decision = await gatePromise
  console.log(`  [WEB] ${decision.action}`)
  return decision.action
}

/**
 * Get revision notes. In CLI mode, prompts readline.
 * In web mode, notes come from the gate decision.
 */
export async function getRevisionNotes(decision?: GateDecision): Promise<string[]> {
  // If notes were provided with the gate decision (web mode), use those
  if (decision?.notes && decision.notes.length > 0) {
    return decision.notes
  }

  if (resolverMode === "auto") return []
  if (resolverMode === "web") return [] // Web mode should have included notes in decision

  // CLI mode — prompt
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
