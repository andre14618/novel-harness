/**
 * Evaluate adherence-checker adapters against synthetic pairs with KNOWN ground truth.
 *
 * Unlike the production eval (which measures agreement with an oracle), this measures
 * absolute accuracy: does the model correctly flag injected failures and pass clean prose?
 *
 * Ground truth comes from variant type:
 *   PASS_*           → all flags should pass
 *   FAIL_MISSING[_*] → events_present = false (others pass)
 *   FAIL_CHAR        → character_contradiction = true (others pass)
 *   FAIL_SETTING[_*] → setting_matches = false (others pass)
 *   FAIL_TANGENT[_*] → is_tangent = true (others pass)
 *
 * Each training example is a single (call_type, variant) pair. We only measure the
 * call_type that the variant targets — e.g., for FAIL_MISSING we only check events.
 *
 * Usage:
 *   bun scripts/eval-adherence-synthetic.ts                    # full eval, V2+V3
 *   bun scripts/eval-adherence-synthetic.ts --smoke            # 50 pairs
 *   bun scripts/eval-adherence-synthetic.ts --only=v3-mixed-teacher
 */
import { readFileSync } from "fs";
import { getTransport } from "../src/transport.ts";

const SMOKE = process.argv.includes("--smoke");
const ONLY = process.argv.find(a => a.startsWith("--only="))?.split("=")[1];

// Raw data file (has _meta with variant + call_type)
const DATA_PATH = process.env.DATA_PATH || "lora-data/adherence-checker-v3-mixed-teacher.jsonl";

const MODELS: Record<string, { provider: string; model: string }> = {
  "base-14b": {
    provider: "wandb",
    model: "OpenPipe/Qwen3-14B-Instruct",
  },
  "v2-curated": {
    provider: "wandb",
    model: "wandb-artifact:///andre14618-/novel-harness/adherence-checker-v2-sft-resume:v9",
  },
  "v3-mixed-teacher": {
    provider: "wandb",
    model: "wandb-artifact:///andre14618-/novel-harness/adherence-checker-v3-sft-resume:v9",
  },
};

const CANDIDATE_MODELS = ONLY
  ? Object.fromEntries(Object.entries(MODELS).filter(([k]) => k === ONLY))
  : MODELS;

// Ground truth: what flag value is expected for this (variant, call_type)?
// Returns undefined if this call_type is not the target for this variant (skip it).
function expectedFlag(variant: string, callType: string): boolean | undefined {
  const isPass = variant.startsWith("PASS_");

  if (isPass) {
    // All flags should pass on PASS variants
    switch (callType) {
      case "events": return true;        // events_present = true
      case "setting": return true;       // setting_matches = true
      case "tangent": return false;      // is_tangent = false
      case "character": return false;    // character_contradiction = false
    }
  }

  // FAIL variants: only the target dimension should fail
  const targetMap: Record<string, string> = {
    "FAIL_MISSING": "events",
    "FAIL_MISSING_SUBTLE": "events",
    "FAIL_CHAR": "character",
    "FAIL_SETTING": "setting",
    "FAIL_SETTING_SWAP": "setting",
    "FAIL_TANGENT": "tangent",
    "FAIL_TANGENT_HARD": "tangent",
  };

  const targetCallType = targetMap[variant];
  if (!targetCallType) return undefined;

  // Only measure the targeted call type
  if (callType !== targetCallType) return undefined;

  // The flag that should fire
  switch (callType) {
    case "events": return false;       // events_present = false (missing)
    case "setting": return false;      // setting_matches = false (wrong)
    case "tangent": return true;       // is_tangent = true (drifted)
    case "character": return true;     // character_contradiction = true
  }
}

function getFlag(callType: string, result: any): boolean | undefined {
  if (!result || result._error || result._parseError) return undefined;
  switch (callType) {
    case "events": return result.events_present;
    case "setting": return result.setting_matches;
    case "tangent": return result.is_tangent;
    case "character": return result.character_contradiction;
  }
}

interface TestPair {
  variant: string;
  callType: string;
  scenario: string;
  writer: string;
  systemPrompt: string;
  userPrompt: string;
  expected: boolean;
}

async function main() {
  console.log("Loading synthetic pairs...");
  const lines = readFileSync(DATA_PATH, "utf-8").trim().split("\n");
  const allPairs: TestPair[] = [];

  for (const line of lines) {
    const obj = JSON.parse(line);
    const meta = obj._meta;
    if (!meta) continue;

    const exp = expectedFlag(meta.variant, meta.call_type);
    if (exp === undefined) continue;

    allPairs.push({
      variant: meta.variant,
      callType: meta.call_type,
      scenario: meta.scenario,
      writer: meta.writer,
      systemPrompt: obj.messages[0].content,
      userPrompt: obj.messages[1].content,
      expected: exp,
    });
  }

  // Deduplicate: keep one per (scenario, variant, call_type) — take first writer
  const seen = new Set<string>();
  const pairs: TestPair[] = [];
  for (const p of allPairs) {
    const key = `${p.scenario}:${p.variant}:${p.callType}`;
    if (seen.has(key)) continue;
    seen.add(key);
    pairs.push(p);
  }

  // Sample if smoke mode
  if (SMOKE) {
    pairs.length = Math.min(pairs.length, 50);
  }

  console.log(`${pairs.length} unique test pairs (from ${allPairs.length} total)`);
  console.log(`Models: ${Object.keys(CANDIDATE_MODELS).join(", ")}\n`);

  const transport = getTransport();
  const candidateEntries = Object.entries(CANDIDATE_MODELS);

  // Results: model → { variant → callType → { tp, fp, tn, fn } }
  type Counts = { tp: number; fp: number; tn: number; fn: number; errors: number };
  const results: Record<string, Record<string, Record<string, Counts>>> = {};
  for (const [name] of candidateEntries) {
    results[name] = {};
  }

  let done = 0;
  const total = pairs.length * candidateEntries.length;
  const CONCURRENCY = 8;

  // Process in batches
  for (let i = 0; i < pairs.length; i += CONCURRENCY) {
    const batch = pairs.slice(i, i + CONCURRENCY);

    await Promise.all(
      batch.flatMap(pair =>
        candidateEntries.map(async ([modelName, modelConfig]) => {
          try {
            const start = Date.now();
            const response = await transport.execute({
              provider: modelConfig.provider,
              model: modelConfig.model,
              systemPrompt: pair.systemPrompt,
              userPrompt: pair.userPrompt,
              temperature: 0.1,
              maxTokens: 512,
              responseFormat: { type: "json_object" },
            });
            const latency = Date.now() - start;

            let result: any;
            try {
              result = JSON.parse(response.content);
            } catch {
              result = { _parseError: true };
            }

            const actual = getFlag(pair.callType, result);
            const r = results[modelName];
            if (!r[pair.variant]) r[pair.variant] = {};
            if (!r[pair.variant][pair.callType]) r[pair.variant][pair.callType] = { tp: 0, fp: 0, tn: 0, fn: 0, errors: 0 };
            const counts = r[pair.variant][pair.callType];

            if (actual === undefined) {
              counts.errors++;
            } else if (pair.expected === actual) {
              // Correct
              if (pair.variant.startsWith("FAIL_")) counts.tp++; // correctly caught failure
              else counts.tn++;  // correctly passed clean
            } else {
              // Wrong
              if (pair.variant.startsWith("FAIL_")) counts.fn++; // missed failure
              else counts.fp++;  // false positive on clean
            }
          } catch (e: any) {
            const r = results[modelName];
            if (!r[pair.variant]) r[pair.variant] = {};
            if (!r[pair.variant][pair.callType]) r[pair.variant][pair.callType] = { tp: 0, fp: 0, tn: 0, fn: 0, errors: 0 };
            r[pair.variant][pair.callType].errors++;
          }

          done++;
        })
      )
    );

    if ((i + CONCURRENCY) % 40 === 0 || i + CONCURRENCY >= pairs.length) {
      console.log(`  Progress: ${Math.min(i + CONCURRENCY, pairs.length)}/${pairs.length} pairs (${done}/${total} calls)`);
    }
  }

  // Report
  for (const [modelName] of candidateEntries) {
    console.log(`\n${"=".repeat(60)}`);
    console.log(`MODEL: ${modelName}`);
    console.log(`${"=".repeat(60)}`);

    const r = results[modelName];

    // Aggregate by call type
    const byCallType: Record<string, Counts> = {};
    const byVariant: Record<string, Counts> = {};

    for (const [variant, callTypes] of Object.entries(r)) {
      for (const [callType, counts] of Object.entries(callTypes)) {
        if (!byCallType[callType]) byCallType[callType] = { tp: 0, fp: 0, tn: 0, fn: 0, errors: 0 };
        byCallType[callType].tp += counts.tp;
        byCallType[callType].fp += counts.fp;
        byCallType[callType].tn += counts.tn;
        byCallType[callType].fn += counts.fn;
        byCallType[callType].errors += counts.errors;

        if (!byVariant[variant]) byVariant[variant] = { tp: 0, fp: 0, tn: 0, fn: 0, errors: 0 };
        byVariant[variant].tp += counts.tp;
        byVariant[variant].fp += counts.fp;
        byVariant[variant].tn += counts.tn;
        byVariant[variant].fn += counts.fn;
        byVariant[variant].errors += counts.errors;
      }
    }

    // Overall
    let totalTP = 0, totalFP = 0, totalTN = 0, totalFN = 0, totalErr = 0;
    for (const c of Object.values(byCallType)) {
      totalTP += c.tp; totalFP += c.fp; totalTN += c.tn; totalFN += c.fn; totalErr += c.errors;
    }
    const totalCorrect = totalTP + totalTN;
    const totalAll = totalTP + totalFP + totalTN + totalFN;
    const accuracy = totalAll > 0 ? Math.round((totalCorrect / totalAll) * 1000) / 10 : 0;
    const precision = (totalTP + totalFP) > 0 ? Math.round((totalTP / (totalTP + totalFP)) * 1000) / 10 : 0;
    const recall = (totalTP + totalFN) > 0 ? Math.round((totalTP / (totalTP + totalFN)) * 1000) / 10 : 0;

    console.log(`\nOverall: ${accuracy}% accuracy (${totalCorrect}/${totalAll}) | precision=${precision}% recall=${recall}% | ${totalErr} errors`);
    console.log(`  TP=${totalTP} FP=${totalFP} TN=${totalTN} FN=${totalFN}`);

    // By call type
    console.log("\nBy call type:");
    for (const [ct, c] of Object.entries(byCallType).sort((a, b) => a[0].localeCompare(b[0]))) {
      const correct = c.tp + c.tn;
      const all = c.tp + c.fp + c.tn + c.fn;
      const acc = all > 0 ? Math.round((correct / all) * 1000) / 10 : 0;
      const prec = (c.tp + c.fp) > 0 ? Math.round((c.tp / (c.tp + c.fp)) * 1000) / 10 : 0;
      const rec = (c.tp + c.fn) > 0 ? Math.round((c.tp / (c.tp + c.fn)) * 1000) / 10 : 0;
      console.log(`  ${ct.padEnd(12)} ${acc}% (${correct}/${all}) prec=${prec}% rec=${rec}% | TP=${c.tp} FP=${c.fp} TN=${c.tn} FN=${c.fn} err=${c.errors}`);
    }

    // By variant
    console.log("\nBy variant:");
    for (const [v, c] of Object.entries(byVariant).sort((a, b) => a[0].localeCompare(b[0]))) {
      const correct = c.tp + c.tn;
      const all = c.tp + c.fp + c.tn + c.fn;
      const acc = all > 0 ? Math.round((correct / all) * 1000) / 10 : 0;
      const label = v.startsWith("FAIL_") ? `TP=${c.tp} FN=${c.fn}` : `TN=${c.tn} FP=${c.fp}`;
      console.log(`  ${v.padEnd(22)} ${acc}% (${correct}/${all}) ${label} err=${c.errors}`);
    }
  }

  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
