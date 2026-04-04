import { Link, useLocation } from "react-router-dom"

const PAGES = [
  { path: "/", label: "Novels" },
  { path: "/config", label: "Config" },
  { path: "/experiments", label: "Experiments" },
  { path: "/operations", label: "Operations" },
  { path: "/dashboard", label: "Dashboard" },
  { path: "/guide", label: "Guide" },
]

export function Nav() {
  const location = useLocation()
  const qs = window.location.search

  return (
    <nav className="main-nav">
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
