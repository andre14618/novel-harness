import { useState } from "react"
import { LoraComparePage } from "./LoraComparePage"
import { AdaptersPage } from "./AdaptersPage"

type Tab = "adapters" | "lora"

export function FinetunePage() {
  const [tab, setTab] = useState<Tab>("adapters")

  return (
    <div>
      <div style={{ display: "flex", gap: 0, borderBottom: "1px solid var(--border-subtle)", padding: "0 32px" }}>
        {(["adapters", "lora"] as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              padding: "10px 20px",
              border: "none",
              borderBottom: `2px solid ${tab === t ? "var(--accent)" : "transparent"}`,
              background: "transparent",
              color: tab === t ? "var(--accent)" : "var(--text-tertiary)",
              fontSize: "0.82rem",
              cursor: "pointer",
              fontFamily: "inherit",
              transition: "color var(--transition-fast)",
            }}
          >
            {t === "adapters" ? "Adapters" : "LoRA Compare"}
          </button>
        ))}
      </div>
      {tab === "adapters" ? <AdaptersPage /> : <LoraComparePage />}
    </div>
  )
}
