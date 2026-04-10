/**
 * Export adherence-checker synthetic pairs as individual JSON files for Claude Code subagent evaluation.
 *
 * Each file contains one (scenario, variant, call_type) pair with the system prompt,
 * user prompt, and expected ground-truth flag value.
 *
 * Usage:
 *   bun scripts/export-adherence-pairs.ts                          # all unique pairs
 *   bun scripts/export-adherence-pairs.ts --limit 200              # first 200
 *   bun scripts/export-adherence-pairs.ts --variants FAIL_MISSING_SUBTLE,FAIL_TANGENT_HARD  # specific variants
 *   bun scripts/export-adherence-pairs.ts --output /tmp/pairs/     # custom output dir
 */
import { readFileSync, mkdirSync, writeFileSync } from "fs";

const DATA_PATH = process.env.DATA_PATH || "lora-data/adherence-checker-v3-mixed-teacher.jsonl";
const OUTPUT_DIR = process.argv.find(a => a.startsWith("--output="))?.split("=")[1] || "/tmp/adherence-pairs";
const LIMIT = parseInt(process.argv.find(a => a.startsWith("--limit="))?.split("=")[1] || "0") || Infinity;
const VARIANTS_FILTER = process.argv.find(a => a.startsWith("--variants="))?.split("=")[1]?.split(",");

interface Meta {
  scenario: string;
  variant: string;
  call_type: string;
  writer: string;
  teacher: string;
}

// Ground truth mapping — same as eval-adherence-synthetic.ts
function expectedFlag(variant: string, callType: string): boolean | undefined {
  const isPass = variant.startsWith("PASS_");

  if (isPass) {
    switch (callType) {
      case "events": return true;
      case "setting": return true;
      case "tangent": return false;
      case "character": return false;
    }
  }

  const targetMap: Record<string, string> = {
    FAIL_MISSING: "events",
    FAIL_MISSING_SUBTLE: "events",
    FAIL_CHAR: "character",
    FAIL_SETTING: "setting",
    FAIL_SETTING_SWAP: "setting",
    FAIL_TANGENT: "tangent",
    FAIL_TANGENT_HARD: "tangent",
  };

  const targetCallType = targetMap[variant];
  if (!targetCallType || callType !== targetCallType) return undefined;

  switch (callType) {
    case "events": return false;
    case "setting": return false;
    case "tangent": return true;
    case "character": return true;
  }
}

// Flag field name per call type
function flagField(callType: string): string {
  switch (callType) {
    case "events": return "events_present";
    case "setting": return "setting_matches";
    case "tangent": return "is_tangent";
    case "character": return "character_contradiction";
    default: return "unknown";
  }
}

// Read and deduplicate
const lines = readFileSync(DATA_PATH, "utf-8").trim().split("\n");
const seen = new Set<string>();
const pairs: Array<{
  id: number;
  scenario: string;
  variant: string;
  call_type: string;
  flag_field: string;
  expected_flag: boolean;
  system_prompt: string;
  user_prompt: string;
}> = [];

let id = 0;
for (const line of lines) {
  const d = JSON.parse(line);
  const meta: Meta = d._meta;
  if (!meta) continue;

  // Variant filter
  if (VARIANTS_FILTER && !VARIANTS_FILTER.includes(meta.variant)) continue;

  // Only keep pairs where we have ground truth for this call_type
  const expected = expectedFlag(meta.variant, meta.call_type);
  if (expected === undefined) continue;

  // Deduplicate by (scenario, variant, call_type, writer) — keep first occurrence
  const key = `${meta.scenario}|${meta.variant}|${meta.call_type}|${meta.writer}`;
  if (seen.has(key)) continue;
  seen.add(key);

  const messages = d.messages;
  if (!messages || messages.length < 2) continue;

  id++;
  pairs.push({
    id,
    scenario: meta.scenario,
    variant: meta.variant,
    call_type: meta.call_type,
    flag_field: flagField(meta.call_type),
    expected_flag: expected,
    system_prompt: messages[0].content,
    user_prompt: messages[1].content,
  });

  if (id >= LIMIT) break;
}

// Write individual files
mkdirSync(OUTPUT_DIR, { recursive: true });
for (const pair of pairs) {
  const filename = `${String(pair.id).padStart(4, "0")}.json`;
  writeFileSync(`${OUTPUT_DIR}/${filename}`, JSON.stringify(pair, null, 2));
}

// Write manifest
writeFileSync(`${OUTPUT_DIR}/manifest.json`, JSON.stringify({
  total: pairs.length,
  by_variant: pairs.reduce((acc, p) => {
    acc[p.variant] = (acc[p.variant] || 0) + 1;
    return acc;
  }, {} as Record<string, number>),
  by_call_type: pairs.reduce((acc, p) => {
    acc[p.call_type] = (acc[p.call_type] || 0) + 1;
    return acc;
  }, {} as Record<string, number>),
  exported_at: new Date().toISOString(),
}, null, 2));

console.log(`Exported ${pairs.length} pairs to ${OUTPUT_DIR}/`);
console.log(`Variants: ${JSON.stringify(pairs.reduce((acc, p) => { acc[p.variant] = (acc[p.variant] || 0) + 1; return acc; }, {} as Record<string, number>))}`);
console.log(`Call types: ${JSON.stringify(pairs.reduce((acc, p) => { acc[p.call_type] = (acc[p.call_type] || 0) + 1; return acc; }, {} as Record<string, number>))}`);
