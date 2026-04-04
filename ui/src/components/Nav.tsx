import { Link, useLocation } from "react-router-dom"

const PAGES = [
  { path: "/", label: "Novels" },
  { path: "/config", label: "Config" },
  { path: "/experiments", label: "Experiments" },
  { path: "/guide", label: "Guide" },
]

export function Nav() {
  const location = useLocation()
  const qs = window.location.search
  const key = new URLSearchParams(qs).get("key") ?? ""
  const currentPath = location.pathname

  return (
    <nav className="main-nav">
      {PAGES.map(p => {
        const active = p.path === "/" ? currentPath === "/" : currentPath.startsWith(p.path)
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
      <div className="nav-divider" />
      <a href={`/?key=${key}`} className="nav-link external">Dashboard</a>
      <a href={`/panel?key=${key}`} className="nav-link external">Operations</a>
    </nav>
  )
}
