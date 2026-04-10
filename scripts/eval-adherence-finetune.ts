/**
 * Evaluate adherence-checker fine-tune adapters (V1/V2/V3) against the 235B oracle.
 *
 * Pulls real beat/prose pairs from production, runs each through:
 *   1. 235B oracle (4 decomposed calls)
 *   2. Base 14B (no LoRA)
 *   3. V1 adapter (uncurated training data)
 *   4. V2 adapter (curated training data)
 *   5. V3 adapter (mixed-teacher curated data)
 *
 * Reports agreement rates per model × call type × variant.
 *
 * Usage:
 *   bun scripts/eval-adherence-finetune.ts --smoke   # 2 chapters, fast sanity check
 *   bun scripts/eval-adherence-finetune.ts            # 20 chapters, full eval
 */
import db from "../data/connection.ts";
import { getTransport } from "../src/transport.ts";

const SMOKE = process.argv.includes("--smoke");
const CHAPTER_LIMIT = SMOKE ? 2 : 20;

const CALL_TYPES = ["events", "setting", "tangent", "character"] as const;

// Adapter URIs — using final checkpoints (v9 = last of 10 saved during 2-epoch training)
// W&B Inference: LoRA artifact URI goes in the `model` field (NOT a separate `lora` field).
const ALL_MODELS = {
  "oracle-235b": {
    provider: "cerebras" as const,
    model: "qwen-3-235b-a22b-instruct-2507",
  },
  "base-14b": {
    provider: "wandb" as const,
    model: "OpenPipe/Qwen3-14B-Instruct",
  },
  "v1-uncurated": {
    provider: "wandb" as const,
    model: "wandb-artifact:///andre14618-/novel-harness/adherence-checker-v1-sft-resume:v9",
  },
  "v2-curated": {
    provider: "wandb" as const,
    model: "wandb-artifact:///andre14618-/novel-harness/adherence-checker-v2-sft-resume:v9",
  },
  "v3-mixed-teacher": {
    provider: "wandb" as const,
    model: "wandb-artifact:///andre14618-/novel-harness/adherence-checker-v3-sft-resume:v9",
  },
};

// --only flag: run oracle + specified model only (e.g. --only v3-mixed-teacher)
const ONLY = process.argv.find(a => a.startsWith("--only="))?.split("=")[1];
const MODELS = ONLY
  ? Object.fromEntries(
      Object.entries(ALL_MODELS).filter(([k]) => k === "oracle-235b" || k === ONLY)
    ) as typeof ALL_MODELS
  : ALL_MODELS;

// System prompts — copied from src/agents/writer/adherence-checker.ts (the inline constants)
const SYSTEM_PROMPTS: Record<typeof CALL_TYPES[number], string> = {
  events: `You verify whether the prose ENACTS a specific scene beat on-page.

Find the passage where the beat's action happens — characters performing the action, dialogue, narration of the action as it occurs in scene.

Rules:
- "Enacted" means the action happens IN SCENE during this prose. Paraphrase, dialogue rewording, and atmospheric expansion are fine.
- A reference to the action as having happened earlier (off-page, past-tense, summarized in narration as backstory) does NOT count as enacted.
- Characters being merely present in the scene is NOT enough — the beat's specific action must occur.
- If you cannot find a passage where the beat is enacted, return events_present=false. Do NOT default to true.

Respond with ONLY valid JSON in this exact shape:
{
  "events_present": true | false,
  "evidence": "<short quoted passage from the prose, ~1-3 sentences>",
  "reasoning": "<one sentence>"
}`,

  setting: `You verify whether the prose CONTRADICTS the expected setting for a scene beat.

The expected setting is a brief description (e.g., "a crowded tavern, evening, smoky torchlight"). This beat may be one of several in a chapter — the prose often inherits setting from earlier beats and does NOT re-establish it. That is normal craft and not a mismatch.

ONLY flag setting_matches=false when the prose places the scene in a CLEARLY DIFFERENT setting than expected. Examples of real contradictions:
- Different named location (tavern vs castle, kitchen vs garden)
- Different building or room when the beat names a specific one
- Outdoors vs indoors when the beat is explicit about which
- Different time of day when the beat is explicit (dawn vs midnight)
- Different city, region, or world

If the prose simply doesn't mention setting markers — it's continuing a scene from a prior beat, focused on dialogue, character interiority, or close action — return setting_matches=true. Absence of setting markers is NOT a mismatch. Only POSITIVE evidence of a different setting counts.

Respond with ONLY valid JSON in this exact shape:
{
  "setting_matches": true | false,
  "expected_setting": "<the expected setting, restated>",
  "actual_setting": "<the setting the prose establishes, or 'inherited from prior beat' if not re-established>",
  "reasoning": "<one sentence>"
}`,

  tangent: `You measure whether the prose has DRIFTED OFF the scene beat into unrelated content.

A "tangent" is the prose abandoning the beat to pursue something the beat does not call for: an unrelated subplot, scene drift to another character's storyline, lengthy unrelated backstory dump, or the prose pivoting away from the beat entirely.

The following are NOT tangents — they are normal prose craft and must NOT be flagged:
- Atmospheric description (weather, sensory details, environmental texture)
- Character interiority (POV character's thoughts, feelings, memories triggered by what's happening)
- Sensory grounding (what the character sees, hears, smells, touches)
- Emotional reactions to the beat's action
- Brief flashes of backstory the beat itself implies
- Dialogue that develops the beat's situation, even if it briefly digresses
- Pacing variation, internal monologue, descriptive flourishes

The threshold for is_tangent=true is HIGH: more than ~60% of the prose must be doing something completely unrelated to the beat. If the beat is happening anywhere in the prose — even surrounded by atmospheric and interior detail — is_tangent=false.

Estimate the off-spec fraction (0.0 = entirely on-spec, 1.0 = entirely off-spec). Only quote a passage if you are flagging is_tangent=true.

Respond with ONLY valid JSON in this exact shape:
{
  "off_spec_fraction": 0.0,
  "off_spec_quote": "<quoted passage, or empty string>",
  "is_tangent": true | false,
  "reasoning": "<one sentence>"
}`,

  character: `You verify whether characters in the prose behave consistently with their roles in a scene beat.

A character "acts contrary to their role" when they do something the beat says they should NOT do, or when they take an action that reverses the beat's intended dynamic (e.g., the beat calls for the character to refuse but the prose has them immediately agree, or the beat calls for confrontation but the prose has them stay silent).

Do NOT flag normal creative interpretation: dialogue rewording, gesture additions, emotional shading, or pacing variation. Only flag clear contradictions.

Respond with ONLY valid JSON in this exact shape:
{
  "character_contradiction": true | false,
  "evidence": "<quoted passage where contradiction occurs, or empty string>",
  "reasoning": "<one sentence>"
}`,
};

// Pull production beat/prose pairs
async function getProductionPairs(limit: number) {
  const chapters = await db`
    SELECT cd.novel_id, cd.chapter_number, cd.prose,
           co.outline_json
    FROM chapter_drafts cd
    JOIN chapter_outlines co ON co.novel_id = cd.novel_id AND co.chapter_number = cd.chapter_number
    WHERE cd.status = ${"approved"}
    ORDER BY RANDOM()
    LIMIT ${limit}
  `;

  const pairs: Array<{
    novelId: string;
    chapter: number;
    beatIndex: number;
    beatDescription: string;
    beatCharacters: string[];
    setting: string;
    prose: string;
  }> = [];

  for (const ch of chapters as any[]) {
    const outline = typeof ch.outline_json === "string"
      ? JSON.parse(ch.outline_json)
      : ch.outline_json;
    const scenes = outline?.scenes || [];
    const paragraphs = (ch.prose as string).split("\n\n").filter((p: string) => p.trim());

    if (scenes.length === 0 || paragraphs.length === 0) continue;

    // Simple grouping: divide paragraphs evenly among beats
    const parasPerBeat = Math.ceil(paragraphs.length / scenes.length);

    for (let i = 0; i < scenes.length && i < 5; i++) {
      const start = i * parasPerBeat;
      const end = Math.min(start + parasPerBeat, paragraphs.length);
      const beatProse = paragraphs.slice(start, end).join("\n\n");
      if (beatProse.length < 50) continue;

      pairs.push({
        novelId: ch.novel_id,
        chapter: ch.chapter_number,
        beatIndex: i,
        beatDescription: scenes[i]?.description || JSON.stringify(scenes[i]),
        beatCharacters: scenes[i]?.characters || [],
        setting: outline?.setting || "",
        prose: beatProse,
      });
    }
  }

  return pairs;
}

// Build user prompt matching production format (from adherence-checker.ts)
function buildUserPrompt(
  callType: typeof CALL_TYPES[number],
  pair: Awaited<ReturnType<typeof getProductionPairs>>[number],
): string {
  const proseTrimmed = pair.prose.slice(0, 2000);
  const charsLine = pair.beatCharacters.join(", ");

  switch (callType) {
    case "events":
      return `BEAT: ${pair.beatDescription}\nCHARACTERS EXPECTED: ${charsLine}\n\nPROSE:\n---\n${proseTrimmed}\n---`;
    case "setting":
      return `BEAT: ${pair.beatDescription}\nEXPECTED SETTING: ${pair.setting}\n\nPROSE:\n---\n${proseTrimmed}\n---`;
    case "tangent":
      return `BEAT: ${pair.beatDescription}\n\nPROSE:\n---\n${proseTrimmed}\n---`;
    case "character":
      return `BEAT: ${pair.beatDescription}\nCHARACTERS EXPECTED: ${charsLine}\n\nPROSE:\n---\n${proseTrimmed}\n---`;
  }
}

// Run a single adherence check call
async function runCheck(
  callType: typeof CALL_TYPES[number],
  pair: Awaited<ReturnType<typeof getProductionPairs>>[number],
  modelConfig: (typeof MODELS)[keyof typeof MODELS],
): Promise<{ result: any; latency: number }> {
  const transport = getTransport();

  const start = Date.now();
  const response = await transport.execute({
    provider: modelConfig.provider,
    model: modelConfig.model,
    systemPrompt: SYSTEM_PROMPTS[callType],
    userPrompt: buildUserPrompt(callType, pair),
    temperature: 0.1,
    maxTokens: 512,
    responseFormat: { type: "json_object" },
  });
  const latency = Date.now() - start;

  let result: any;
  try {
    result = JSON.parse(response.content);
  } catch {
    result = { _parseError: true, raw: response.content?.slice(0, 200) };
  }

  return { result, latency };
}

// Extract the boolean flag for each call type
function getFlag(callType: string, result: any): boolean | undefined {
  if (!result || result._error || result._parseError) return undefined;
  switch (callType) {
    case "events":    return result.events_present;
    case "setting":   return result.setting_matches;
    case "tangent":   return result.is_tangent;
    case "character": return result.character_contradiction;
    default:          return undefined;
  }
}

async function main() {
  console.log(`Fetching production pairs (${SMOKE ? "SMOKE" : "full"} mode, ${CHAPTER_LIMIT} chapters)...`);
  const pairs = await getProductionPairs(CHAPTER_LIMIT);
  console.log(`Got ${pairs.length} beat/prose pairs from ${CHAPTER_LIMIT} chapters\n`);

  // Track results
  const results: Array<{
    pairIdx: number;
    callType: string;
    modelName: string;
    result: any;
    latency: number;
  }> = [];

  // Evaluate each pair × call type × model
  const modelEntries = Object.entries(MODELS);
  let done = 0;
  const total = pairs.length * CALL_TYPES.length * modelEntries.length;

  for (let pi = 0; pi < pairs.length; pi++) {
    const pair = pairs[pi];

    for (const callType of CALL_TYPES) {
      // Run all models in parallel for this pair × call type
      const modelResults = await Promise.all(
        modelEntries.map(async ([modelName, modelConfig]) => {
          try {
            const { result, latency } = await runCheck(callType, pair, modelConfig);
            done++;
            return { pairIdx: pi, callType, modelName, result, latency };
          } catch (e: any) {
            done++;
            return {
              pairIdx: pi,
              callType,
              modelName,
              result: { _error: e.message?.slice(0, 100) },
              latency: 0,
            };
          }
        })
      );
      results.push(...modelResults);
    }

    if ((pi + 1) % 5 === 0) {
      console.log(`  Progress: ${pi + 1}/${pairs.length} pairs (${done}/${total} calls)`);
    }
  }

  // Compute agreement rates
  console.log("\n=== AGREEMENT WITH ORACLE (235B) ===\n");

  // Group results by pairIdx + callType
  const byKey = new Map<string, Map<string, any>>();
  for (const r of results) {
    const key = `${r.pairIdx}:${r.callType}`;
    if (!byKey.has(key)) byKey.set(key, new Map());
    byKey.get(key)!.set(r.modelName, r);
  }

  // For each model, compute agreement with oracle
  const modelNames = modelEntries
    .map(([n]) => n)
    .filter((n) => n !== "oracle-235b");

  // Also track disagreement details for diagnosis
  const disagreements: Array<{
    modelName: string;
    callType: string;
    pairIdx: number;
    oracleFlag: any;
    candidateFlag: any;
  }> = [];

  for (const modelName of modelNames) {
    const agreementByType: Record<string, { agree: number; total: number }> = {};
    const latencies: number[] = [];

    for (const [key, models] of byKey) {
      const callType = key.split(":")[1];
      const oracle = models.get("oracle-235b");
      const candidate = models.get(modelName);
      if (!oracle || !candidate) continue;
      if (oracle.result._error || candidate.result._error) continue;
      if (oracle.result._parseError || candidate.result._parseError) continue;

      if (!agreementByType[callType]) {
        agreementByType[callType] = { agree: 0, total: 0 };
      }
      agreementByType[callType].total++;

      const oracleFlag = getFlag(callType, oracle.result);
      const candidateFlag = getFlag(callType, candidate.result);

      if (oracleFlag === candidateFlag) {
        agreementByType[callType].agree++;
      } else {
        disagreements.push({
          modelName,
          callType,
          pairIdx: parseInt(key.split(":")[0]),
          oracleFlag,
          candidateFlag,
        });
      }

      latencies.push(candidate.latency);
    }

    const totalAgree = Object.values(agreementByType).reduce(
      (s, a) => s + a.agree,
      0
    );
    const totalCount = Object.values(agreementByType).reduce(
      (s, a) => s + a.total,
      0
    );
    const avgLatency = latencies.length
      ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)
      : 0;

    console.log(
      `${modelName}: ${totalAgree}/${totalCount} (${totalCount > 0 ? Math.round((totalAgree / totalCount) * 100) : 0}%) | avg ${avgLatency}ms`
    );
    for (const [ct, { agree, total }] of Object.entries(agreementByType)) {
      console.log(
        `  ${ct.padEnd(12)} ${agree}/${total} (${total > 0 ? Math.round((agree / total) * 100) : 0}%)`
      );
    }
    console.log("");
  }

  // Oracle latency stats
  const oracleLatencies = results
    .filter((r) => r.modelName === "oracle-235b")
    .map((r) => r.latency);
  const avgOracleLatency = oracleLatencies.length
    ? Math.round(
        oracleLatencies.reduce((a, b) => a + b, 0) / oracleLatencies.length
      )
    : 0;
  console.log(`Oracle (235B) avg latency: ${avgOracleLatency}ms`);

  // Error/parse-failure summary
  const errors = results.filter((r) => r.result._error);
  const parseErrors = results.filter((r) => r.result._parseError);
  if (errors.length > 0 || parseErrors.length > 0) {
    console.log(`\n--- Errors: ${errors.length} API errors, ${parseErrors.length} parse errors ---`);
    for (const e of errors.slice(0, 5)) {
      console.log(`  ${e.modelName}/${e.callType}: ${e.result._error}`);
    }
    for (const e of parseErrors.slice(0, 5)) {
      console.log(`  ${e.modelName}/${e.callType} parse: ${e.result.raw}`);
    }
  }

  // Show first few disagreements for diagnosis
  if (disagreements.length > 0) {
    console.log(`\n--- Sample disagreements (${disagreements.length} total) ---`);
    for (const d of disagreements.slice(0, 10)) {
      console.log(`  ${d.modelName} ${d.callType} pair#${d.pairIdx}: oracle=${d.oracleFlag} candidate=${d.candidateFlag}`);
    }
  }

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
