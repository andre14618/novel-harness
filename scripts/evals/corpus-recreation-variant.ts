export interface CorpusRecreationDiagnosticConfig {
  plannerVariant?: string | null
  plannerContractRetryMode?: string | null
  writerContextMode?: string | null
  writerExpansionMode?: string | null
}

export function corpusRecreationVariantLabel(config?: CorpusRecreationDiagnosticConfig | null): string {
  const plannerVariant = nonEmpty(config?.plannerVariant) ?? "baseline"
  const plannerContractRetryMode = nonEmpty(config?.plannerContractRetryMode) ?? "none"
  const writerContextMode = nonEmpty(config?.writerContextMode) ?? "baseline"
  const writerExpansionMode = nonEmpty(config?.writerExpansionMode) ?? "none"
  return [
    plannerVariant,
    ...(plannerContractRetryMode === "none" ? [] : [`planner-contract-${plannerContractRetryMode}`]),
    ...(writerContextMode === "baseline" ? [] : [writerContextMode]),
    ...(writerExpansionMode === "none" ? [] : [writerExpansionMode]),
  ].join(" + ")
}

function nonEmpty(value: string | null | undefined): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null
}
