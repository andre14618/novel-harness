export interface CorpusRecreationDiagnosticConfig {
  plannerVariant?: string | null
  writerContextMode?: string | null
  writerExpansionMode?: string | null
}

export function corpusRecreationVariantLabel(config?: CorpusRecreationDiagnosticConfig | null): string {
  const plannerVariant = nonEmpty(config?.plannerVariant) ?? "baseline"
  const writerContextMode = nonEmpty(config?.writerContextMode) ?? "baseline"
  const writerExpansionMode = nonEmpty(config?.writerExpansionMode) ?? "none"
  return [
    plannerVariant,
    ...(writerContextMode === "baseline" ? [] : [writerContextMode]),
    ...(writerExpansionMode === "none" ? [] : [writerExpansionMode]),
  ].join(" + ")
}

function nonEmpty(value: string | null | undefined): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null
}
