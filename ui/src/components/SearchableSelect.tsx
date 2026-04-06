import { useState, useRef, useEffect, useCallback } from "react"

export interface SelectOption {
  value: string
  label: string
  sublabel?: string
}

interface Props {
  value: string
  onChange: (value: string) => void
  options: SelectOption[]
  placeholder?: string
  disabled?: boolean
  style?: React.CSSProperties
}

export function SearchableSelect({ value, onChange, options, placeholder = "Select...", disabled, style }: Props) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState("")
  const [focusIndex, setFocusIndex] = useState(-1)
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const selected = options.find(o => o.value === value)

  const filtered = search
    ? options.filter(o =>
        o.label.toLowerCase().includes(search.toLowerCase()) ||
        o.value.toLowerCase().includes(search.toLowerCase()) ||
        (o.sublabel ?? "").toLowerCase().includes(search.toLowerCase())
      )
    : options

  const handleOpen = useCallback(() => {
    if (disabled) return
    setOpen(true)
    setSearch("")
    setFocusIndex(-1)
    setTimeout(() => inputRef.current?.focus(), 0)
  }, [disabled])

  const handleSelect = useCallback((val: string) => {
    onChange(val)
    setOpen(false)
    setSearch("")
  }, [onChange])

  // Close on outside click
  useEffect(() => {
    if (!open) return
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
        setSearch("")
      }
    }
    document.addEventListener("mousedown", onClickOutside)
    return () => document.removeEventListener("mousedown", onClickOutside)
  }, [open])

  // Scroll focused item into view
  useEffect(() => {
    if (focusIndex < 0 || !listRef.current) return
    const items = listRef.current.querySelectorAll("[data-option]")
    items[focusIndex]?.scrollIntoView({ block: "nearest" })
  }, [focusIndex])

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      setOpen(false)
      setSearch("")
      return
    }
    if (e.key === "ArrowDown") {
      e.preventDefault()
      setFocusIndex(i => Math.min(i + 1, filtered.length - 1))
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      setFocusIndex(i => Math.max(i - 1, 0))
    } else if (e.key === "Enter" && focusIndex >= 0 && filtered[focusIndex]) {
      e.preventDefault()
      handleSelect(filtered[focusIndex].value)
    }
  }

  return (
    <div
      ref={containerRef}
      className="ss-container"
      style={style}
    >
      {/* Closed state — shows current value */}
      {!open && (
        <button
          type="button"
          className="ss-trigger"
          onClick={handleOpen}
          disabled={disabled}
        >
          <span className="ss-value">
            {selected?.label ?? <span className="ss-placeholder">{placeholder}</span>}
          </span>
          <span className="ss-chevron">{"\u25BE"}</span>
        </button>
      )}

      {/* Open state — search input + dropdown */}
      {open && (
        <>
          <input
            ref={inputRef}
            className="ss-search"
            type="text"
            value={search}
            onChange={e => { setSearch(e.target.value); setFocusIndex(0) }}
            onKeyDown={handleKeyDown}
            placeholder={`Search ${options.length} options...`}
          />
          <div ref={listRef} className="ss-dropdown">
            {filtered.length === 0 && (
              <div className="ss-empty">No matches</div>
            )}
            {filtered.map((opt, i) => (
              <div
                key={opt.value}
                data-option
                className={`ss-option ${opt.value === value ? "ss-selected" : ""} ${i === focusIndex ? "ss-focused" : ""}`}
                onMouseEnter={() => setFocusIndex(i)}
                onMouseDown={e => { e.preventDefault(); handleSelect(opt.value) }}
              >
                <span className="ss-option-label">{opt.label}</span>
                {opt.sublabel && <span className="ss-option-sub">{opt.sublabel}</span>}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
