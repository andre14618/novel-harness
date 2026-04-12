import { useEffect, useState } from "react"
import { useSearchParams } from "react-router-dom"
import { listNovels, getOutlines, getBeats, type BeatData, type NovelListItem } from "../api"

// ── Metrics ─────────────────────────────────────────────────────────

function specEcho(prose: string, description: string): number {
  if (!prose || !description) return 0
  const bigrams = (text: string): Set<string> => {
    const words = text.toLowerCase().replace(/[^\w\s]/g, "").split(/\s+/).filter(Boolean)
    const set = new Set<string>()
    for (let i = 0; i < words.length - 1; i++) set.add(`${words[i]} ${words[i + 1]}`)
    return set
  }
  const specB = bigrams(description)
  if (specB.size === 0) return 0
  const proseB = bigrams(prose)
  let overlap = 0
  for (const bg of specB) if (proseB.has(bg)) overlap++
  return overlap / specB.size
}

function dialoguePct(prose: string): number {
  if (!prose) return 0
  const total = prose.split(/\s+/).filter(Boolean).length
  if (total === 0) return 0
  const matches = prose.match(/"[^"]*"/g) || []
  const dlg = matches.reduce((s, m) => s + m.split(/\s+/).filter(Boolean).length, 0)
  return (dlg / total) * 100
}

// ── Types ───────────────────────────────────────────────────────────

interface OutlineData {
  chapterNumber: number
  title: string
  scenes: { description: string; characters: string[]; emotionalShift: string }[]
  [key: string]: any
}

interface NovelData {
  novel: NovelListItem
  outlines: OutlineData[]
  beats: BeatData[]
}

// ── Component ───────────────────────────────────────────────────────

export function ComparePage() {
  const [params, setParams] = useSearchParams()
  const [novels, setNovels] = useState<NovelListItem[]>([])
  const [dataA, setDataA] = useState<NovelData | null>(null)
  const [dataB, setDataB] = useState<NovelData | null>(null)
  const [loadingA, setLoadingA] = useState(false)
  const [loadingB, setLoadingB] = useState(false)

  const idA = params.get("a") ?? ""
  const idB = params.get("b") ?? ""
  const ch = parseInt(params.get("ch") ?? "1") || 1
  const beatParam = params.get("beat")
  const beat = beatParam !== null ? parseInt(beatParam) : null

  const set = (updates: Record<string, string | null>) => {
    setParams(prev => {
      const next = new URLSearchParams(prev)
      for (const [k, v] of Object.entries(updates))
        v === null ? next.delete(k) : next.set(k, v)
      return next
    }, { replace: true })
  }

  useEffect(() => {
    listNovels().then(r => {
      setNovels(r.novels)
      const a = params.get("a"), b = params.get("b")
      if (a) load(a, "A", r.novels)
      if (b) load(b, "B", r.novels)
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const load = async (novelId: string, side: "A" | "B", list?: NovelListItem[]) => {
    const setLoading = side === "A" ? setLoadingA : setLoadingB
    const setData = side === "A" ? setDataA : setDataB
    if (!novelId) { setData(null); return }
    setLoading(true)
    try {
      const novel = (list ?? novels).find(n => n.id === novelId)!
      const [outlines, beats] = await Promise.all([getOutlines(novelId), getBeats(novelId)])
      setData({ novel, outlines, beats })
    } catch (err) {
      console.error(err)
      setData(null)
    } finally {
      setLoading(false)
    }
  }

  const pickA = (id: string) => { set({ a: id || null, ch: "1", beat: null }); load(id, "A") }
  const pickB = (id: string) => { set({ b: id || null, ch: "1", beat: null }); load(id, "B") }

  // Derive chapter/beat structure
  const outA = dataA?.outlines.find(o => o.chapterNumber === ch)
  const outB = dataB?.outlines.find(o => o.chapterNumber === ch)
  const maxCh = Math.max(dataA?.outlines.length ?? 0, dataB?.outlines.length ?? 0)
  const scenes = outA?.scenes ?? outB?.scenes ?? []
  const maxBeats = scenes.length

  const beatsA = dataA?.beats.filter(b => b.chapter === ch).sort((a, b) => a.beatIndex - b.beatIndex) ?? []
  const beatsB = dataB?.beats.filter(b => b.chapter === ch).sort((a, b) => a.beatIndex - b.beatIndex) ?? []

  const beatsToShow = beat !== null ? [beat] : Array.from({ length: maxBeats }, (_, i) => i)

  const label = (n: NovelListItem) => {
    const d = new Date(n.createdAt)
    const date = `${d.getMonth() + 1}/${d.getDate()}`
    const premise = n.seed?.premise ?? ""
    return `${n.id.slice(-6)} | ${n.seed?.genre ?? "?"} | ${date} | ${premise.length > 50 ? premise.slice(0, 50) + "..." : premise}`
  }

  const sameSeed = dataA && dataB &&
    dataA.novel.seed?.premise === dataB.novel.seed?.premise &&
    dataA.novel.seed?.genre === dataB.novel.seed?.genre

  return (
    <div className="cmp">
      {/* Pickers */}
      <div className="cmp-pickers">
        <Picker label="A" value={idA} novels={novels} onChange={pickA} labelFn={label} />
        <Picker label="B" value={idB} novels={novels} onChange={pickB} labelFn={label} />
      </div>

      {sameSeed && <div className="cmp-same-seed">Same seed — specs aligned</div>}

      {/* Navigation */}
      {maxCh > 0 && (
        <div className="cmp-nav">
          <NavGroup label="Ch">
            {Array.from({ length: maxCh }, (_, i) => i + 1).map(c => (
              <button key={c} className={`cmp-btn ${ch === c ? "on" : ""}`}
                onClick={() => set({ ch: String(c), beat: null })}>{c}</button>
            ))}
          </NavGroup>
          {maxBeats > 0 && (
            <NavGroup label="Beat">
              <button className={`cmp-btn ${beat === null ? "on" : ""}`}
                onClick={() => set({ beat: null })}>All</button>
              {Array.from({ length: maxBeats }, (_, i) => i).map(b => (
                <button key={b} className={`cmp-btn ${beat === b ? "on" : ""}`}
                  onClick={() => set({ beat: String(b) })}>{b + 1}</button>
              ))}
            </NavGroup>
          )}
        </div>
      )}

      {(loadingA || loadingB) && <div className="cmp-loading">Loading...</div>}

      {/* Beat rows */}
      {!loadingA && !loadingB && maxBeats > 0 && (
        <div className="cmp-beats">
          {beatsToShow.map(bi => {
            const scene = scenes[bi]
            const bA = beatsA.find(b => b.beatIndex === bi)
            const bB = beatsB.find(b => b.beatIndex === bi)
            return <BeatRow key={bi} bi={bi} scene={scene} beatA={bA} beatB={bB} />
          })}
        </div>
      )}

      {!loadingA && !loadingB && !idA && !idB && (
        <div className="cmp-empty">Select two novels from the same seed to compare prose output</div>
      )}
    </div>
  )
}

// ── Sub-components ──────────────────────────────────────────────────

function Picker({ label, value, novels, onChange, labelFn }: {
  label: string; value: string; novels: NovelListItem[]
  onChange: (id: string) => void; labelFn: (n: NovelListItem) => string
}) {
  return (
    <div className="cmp-picker">
      <label className="cmp-picker-label">{label}</label>
      <select className="cmp-select" value={value} onChange={e => onChange(e.target.value)}>
        <option value="">Select novel...</option>
        {novels.map(n => <option key={n.id} value={n.id}>{labelFn(n)}</option>)}
      </select>
    </div>
  )
}

function NavGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="cmp-nav-group">
      <span className="cmp-nav-label">{label}</span>
      {children}
    </div>
  )
}

function BeatRow({ bi, scene, beatA, beatB }: {
  bi: number
  scene: { description: string; characters: string[]; emotionalShift: string } | undefined
  beatA: BeatData | undefined
  beatB: BeatData | undefined
}) {
  const desc = scene?.description ?? ""
  const echoA = specEcho(beatA?.prose ?? "", desc)
  const echoB = specEcho(beatB?.prose ?? "", desc)
  const dlgA = dialoguePct(beatA?.prose ?? "")
  const dlgB = dialoguePct(beatB?.prose ?? "")
  const wA = beatA?.wordCount ?? 0
  const wB = beatB?.wordCount ?? 0

  return (
    <div className="cmp-beat">
      {/* Header: beat number + metrics for both sides */}
      <div className="cmp-beat-head">
        <span className="cmp-beat-num">Beat {bi + 1}</span>
        <div className="cmp-beat-metrics">
          <Badges label="A" echo={echoA} dlg={dlgA} words={wA} />
          <Badges label="B" echo={echoB} dlg={dlgB} words={wB} />
        </div>
      </div>

      {/* Spec — shown once */}
      {scene && (
        <div className="cmp-spec">
          <div className="cmp-spec-text">{desc}</div>
          {scene.characters.length > 0 && (
            <div className="cmp-spec-meta">{scene.characters.join(", ")}{scene.emotionalShift ? ` — ${scene.emotionalShift}` : ""}</div>
          )}
        </div>
      )}

      {/* A | B prose side by side */}
      <div className="cmp-prose-row">
        <div className="cmp-prose-col">
          <div className="cmp-prose-label">A</div>
          {beatA ? <div className="cmp-prose">{beatA.prose}</div> : <div className="cmp-no-data">No output</div>}
        </div>
        <div className="cmp-prose-col">
          <div className="cmp-prose-label">B</div>
          {beatB ? <div className="cmp-prose">{beatB.prose}</div> : <div className="cmp-no-data">No output</div>}
        </div>
      </div>
    </div>
  )
}

function Badges({ label, echo, dlg, words }: { label: string; echo: number; dlg: number; words: number }) {
  return (
    <div className="cmp-badges">
      <span className="cmp-badge-label">{label}</span>
      <span className={`cmp-badge ${echo < 0.20 ? "good" : "warn"}`}>E {(echo * 100).toFixed(0)}%</span>
      <span className={`cmp-badge ${dlg > 20 ? "good" : "warn"}`}>D {dlg.toFixed(0)}%</span>
      <span className="cmp-badge">{words}w</span>
    </div>
  )
}
