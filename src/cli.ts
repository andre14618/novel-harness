import type { SeedInput, CharacterSketch } from "./types"
import * as readline from "node:readline"
import * as gates from "./gates"
import type { GateDecision, GateResolverMode, PlanAssistDecision, PlanAssistGatePayload } from "./gates"

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

// Stores the last gate decision so callers can access revision notes
let lastDecision: GateDecision | null = null

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
  lastDecision = null

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
    lastDecision = { action: "approve" }
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
    lastDecision = decision

    // If CLI won, resolve the gate so web clients get notified
    if (gates.getPending(novelId)) {
      gates.resolve(novelId, gateId, decision)
    }

    return decision.action
  }

  // Web mode — just wait for the API to resolve it
  console.log("  [WAITING] Approval pending in web UI...")
  const decision = await gatePromise
  lastDecision = decision
  console.log(`  [WEB] ${decision.action}`)
  return decision.action
}

/**
 * Get revision notes. Uses notes from the last gate decision if available
 * (web mode sends them with the decision). Falls back to CLI readline.
 */
export async function getRevisionNotes(): Promise<string[]> {
  // If the gate decision included notes (web mode), use those
  if (lastDecision?.notes && lastDecision.notes.length > 0) {
    return lastDecision.notes
  }

  if (resolverMode === "auto") return []
  if (resolverMode === "web") return [] // Web client should have included notes in decision

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

/**
 * Present a plan-assist exhaustion gate. Auto mode rethrows the
 * PipelineBailError from `requestPlanAssist` so the run halts loudly
 * (see docs/exhaustion-handler-design.md §"Auto-mode behavior").
 *
 * CLI mode: `[o]verride / [a]bort` only. Full plan edits require the web
 * UI — CLI readline is a poor surface for multi-line JSON input, and
 * step-4 of the design memo covers the Studio panel for edit-plan.
 *
 * Web mode: registers the gate + waits for /api/novel/plan-assist/resolve.
 *
 * Scaffolding only — no callers in this commit. Step 3 of the design
 * memo wires this into drafting.ts paths (A), (B), and rewires (C).
 */
export async function presentForExhaustion(
  payload: PlanAssistGatePayload,
): Promise<PlanAssistDecision> {
  console.log(`\n${"─".repeat(60)}`)
  console.log(`  PLAN-ASSIST GATE — ${payload.kind} (chapter ${payload.chapter})`)
  console.log("─".repeat(60))
  console.log(`  Unresolved issues (${payload.unresolvedDeviations.length}):`)
  for (const d of payload.unresolvedDeviations) {
    const beat = d.beat_index == null ? "chapter-level" : `beat ${d.beat_index}`
    console.log(`    - [${beat}] ${d.description}`)
  }
  if (payload.reviserHistory) {
    console.log(`  Reviser was invoked and rejected: ${payload.reviserHistory.rejectionReason}`)
  }
  console.log("─".repeat(60))

  // requestPlanAssist throws synchronously in auto mode — we let it
  // propagate. CLI and web modes return a pending promise.
  const gatePromise = gates.requestPlanAssist(payload, resolverMode)

  if (resolverMode === "cli") {
    const cliPromise = (async (): Promise<PlanAssistDecision> => {
      while (true) {
        const answer = await ask("[o]verride / [a]bort? ")
        const lower = answer.toLowerCase()
        if (lower === "o" || lower === "override") return { action: "override" }
        if (lower === "a" || lower === "abort") return { action: "abort" }
        console.log("  Please enter 'o' or 'a' (edit-plan is web-only in the scaffolding commit)")
      }
    })()

    const decision = await Promise.race([gatePromise, cliPromise])
    if (gates.getPendingPlanAssist(payload.novelId)) {
      gates.resolvePlanAssist(payload.novelId, payload.chapter, decision)
    }
    return decision
  }

  // Web mode
  console.log("  [WAITING] Plan-assist pending in web UI...")
  const decision = await gatePromise
  console.log(`  [WEB] ${decision.action}`)
  return decision
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
      `    ${i + 1}. [${s.kind ?? "?"}] ${s.description}`
    ).join("\n")}`
    return out
  }).join("\n\n")
}
