#!/usr/bin/env bun

import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import YAML from "yaml"
import { executeAndLog } from "../../src/llm"
import { getAgentConfig } from "../../src/models/roles"
import { getModel } from "../../src/models/registry"
import { createRun } from "../../src/db/ops"
import { initExperimentRun, setRunIdForTest } from "../../src/logger"

type Json = Record<string, any>

function optionalArg(name: string): string | null {
  const idx = process.argv.indexOf(name)
  if (idx === -1 || idx + 1 >= process.argv.length) return null
  return process.argv[idx + 1]
}

function loadYaml(path: string): any {
  return YAML.parse(readFileSync(path, "utf8"))
}

function must<T>(value: T | null | undefined, message: string): T {
  if (value === null || value === undefined || value === "") throw new Error(message)
  return value
}

function responseFormatFor(value: string | undefined): { type: string } {
  if (!value || value === "json_object") return { type: "json_object" }
  if (value === "text") return { type: "text" }
  throw new Error(`unsupported response_format: ${value}`)
}

const requestFile = must(optionalArg("--request"), "usage: bun scripts/arc-lab/transport-generation.ts --request <yaml> --arc-lab-root <path>")
const requestPath = resolve(process.cwd(), requestFile)
const arcLabRoot = resolve(must(optionalArg("--arc-lab-root"), "--arc-lab-root is required"))
const bundle = loadYaml(requestPath)

const run = bundle.run ?? {}
const request = bundle.request ?? {}
const output = bundle.output ?? {}

const transportRole = must<string>(request.transport_role, "request.transport_role is required")
const transportPolicy = loadYaml(resolve(arcLabRoot, "runtime/transport.generation.yml"))
const route = transportPolicy.routes?.[transportRole]
if (!route) throw new Error(`transport role not configured: ${transportRole}`)

const agentName = route.transport_agent_name as string
const roleConfig = must(getAgentConfig(agentName), `no harness role found for agent ${agentName}`)

const runId = run.experiment_id != null
  ? await initExperimentRun(run.experiment_id, run.run_type ?? "arc-lab-transport", run.run_ref, run.label)
  : await createRun(run.run_type ?? "arc-lab-transport", run.run_ref, run.label)

if (run.experiment_id == null) {
  setRunIdForTest(runId)
}

const effectiveTemperature = request.temperature ?? roleConfig.temperature ?? 0.7
const effectiveMaxTokens = request.max_tokens ?? roleConfig.maxTokens ?? 4096
const effectiveProvider = request.provider ?? roleConfig.provider
const effectiveModel = request.model ?? roleConfig.model
const effectiveResponseFormat = responseFormatFor(request.response_format ?? route.response_format)
const modelDef = getModel(effectiveModel, effectiveProvider)

const response = await executeAndLog(
  {
    systemPrompt: must<string>(request.system_prompt, "request.system_prompt is required"),
    userPrompt: must<string>(request.user_prompt, "request.user_prompt is required"),
    model: effectiveModel,
    provider: effectiveProvider,
    temperature: effectiveTemperature,
    maxTokens: effectiveMaxTokens,
    responseFormat: effectiveResponseFormat,
    extraBody: request.extra_body ?? {},
    useMaxCompletionTokens: modelDef?.useMaxCompletionTokens ?? false,
  },
  undefined,
  agentName,
  undefined,
  {
    meta: {
      ...(request.metadata ?? {}),
      project: request.metadata?.project ?? "arc-lab",
      transport_role: transportRole,
      transport_route: route.output_mode,
      benchmark_version: request.metadata?.benchmark_version ?? null,
      batch: request.metadata?.batch ?? null,
      task_family: request.metadata?.task_family ?? null,
      phase: request.metadata?.phase ?? null,
      run_id: runId,
      request_file: requestPath,
    },
  },
)

const result: Json = {
  ok: true,
  run_id: runId,
  transport_role: transportRole,
  agent_name: agentName,
  provider: effectiveProvider,
  model: effectiveModel,
  response_format: effectiveResponseFormat.type,
  usage: response.usage,
  latency_ms: response.latencyMs,
  http_attempts: response.httpAttempts,
  retry_errors: response.retryErrors,
  content: response.content,
}

if (output.path) {
  const outPath = resolve(arcLabRoot, output.path)
  mkdirSync(dirname(outPath), { recursive: true })
  writeFileSync(outPath, JSON.stringify(result, null, 2) + "\n")
}

console.log(JSON.stringify(result, null, 2))
