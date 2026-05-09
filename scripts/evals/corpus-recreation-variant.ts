export interface CorpusRecreationDiagnosticConfig {
  plannerVariant?: string | null
  writerContextMode?: string | null
}

export function corpusRecreationVariantLabel(config?: CorpusRecreationDiagnosticConfig | null): string {
  const plannerVariant = nonEmpty(config?.plannerVariant) ?? "baseline"
  const writerContextMode = nonEmpty(config?.writerContextMode) ?? "baseline"
  return writerContextMode === "baseline" ? plannerVariant : `${plannerVariant} + ${writerContextMode}`
}

function nonEmpty(value: string | null | undefined): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null
}
