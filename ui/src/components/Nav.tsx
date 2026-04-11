import { Link, useLocation } from "react-router-dom"

const PAGES = [
  { path: "/guide", label: "Overview" },
  { path: "/studio", label: "Studio" },
  { path: "/read", label: "Read" },
  { path: "/config", label: "Config" },
  { path: "/llm-calls", label: "Inspector" },
  { path: "/costs", label: "Costs" },
  { path: "/experiments", label: "Experiments" },
  { path: "/models", label: "Models" },
  { path: "/lora", label: "LoRA" },
  { path: "/adapters", label: "Adapters" },
  { path: "/context-engineering", label: "Context" },
  { path: "/decisions", label: "Decisions" },
  { path: "/docs", label: "Docs" },
]

export function Nav() {
  const location = useLocation()
  const qs = window.location.search

  return (
    <nav className="main-nav">
      <span style={{
        fontSize: "0.72rem",
        fontWeight: 700,
        color: "var(--accent)",
        padding: "0 12px 0 8px",
        letterSpacing: "0.04em",
        whiteSpace: "nowrap",
        borderRight: "1px solid var(--border-subtle)",
        marginRight: "4px",
      }}>
        NH
      </span>
      {PAGES.map(p => {
        const active = p.path === "/"
          ? location.pathname === "/"
          : location.pathname.startsWith(p.path)
        return (
          <Link
            key={p.path}
            to={`${p.path}${qs}`}
            className={`nav-link ${active ? "active" : ""}`}
          >
            {p.label}
          </Link>
        )
      })}
    </nav>
  )
}
