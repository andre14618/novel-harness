import { Link, useLocation } from "react-router-dom"

const PAGES = [
  { path: "/studio", label: "The Studio" },
  { path: "/guide", label: "Overview" },
  { path: "/context", label: "Context Engineering" },
  { path: "/workflow", label: "Workflow" },
  { path: "/finetune", label: "Fine-Tuning" },
  { path: "/diagnostics", label: "Diagnostics", matches: ["/semantic-gate-matrix", "/semantic-gate-baseline"] },
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
          : location.pathname.startsWith(p.path) || p.matches?.some(path => location.pathname.startsWith(path))
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
