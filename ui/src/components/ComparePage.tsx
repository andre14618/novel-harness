import { useEffect, useState, useMemo, type ReactNode } from "react"
import { useSearchParams } from "react-router-dom"
import { listNovels, getAllChapters, getOutlines, getBeats, type BeatData, type ChapterData, type NovelListItem } from "../api"

// ── Word-level diff (LCS-based, no dependencies) ────────���───────────

type DiffOp = { type: "equal" | "add" | "del"; text: string }

/** Tokenize text into words preserving whitespace for reconstruction. */
function tokenize(text: string): string[] {
  return text.match(/\S+|\n+/g) ?? []
}

/** Longest common subsequence — returns index pairs. */
function lcs(a: string[], b: string[]): [number, number][] {
  const m = a.length, n = b.length
  // Optimize: if either is very long, use a patience-like approach with limited window
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))
  for (let i = m - 1; i >= 0; i--)
    for (let j = n - 1; j >= 0; j--)
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])

  const pairs: [number, number][] = []
  let i = 0, j = 0
  while (i < m && j < n) {
    if (a[i] === b[j]) { pairs.push([i, j]); i++; j++ }
    else if (dp[i + 1][j] >= dp[i][j + 1]) i++
    else j++
  }
  return pairs
}

/** Compute word-level diff between two texts. */
function wordDiff(textA: string, textB: string): DiffOp[] {
  const wordsA = tokenize(textA)
  const wordsB = tokenize(textB)
  const pairs = lcs(wordsA, wordsB)

  const ops: DiffOp[] = []
  let ai = 0, bi = 0
  for (const [pa, pb] of pairs) {
    // Words in A before this match = deletions
    if (ai < pa) ops.push({ type: "del", text: wordsA.slice(ai, pa).join(" ") })
    // Words in B before this match = additions
    if (bi < pb) ops.push({ type: "add", text: wordsB.slice(bi, pb).join(" ") })
    // The match itself
    ops.push({ type: "equal", text: wordsA[pa] })
    ai = pa + 1
    bi = pb + 1
  }
  // Remaining words after last match
  if (ai < wordsA.length) ops.push({ type: "del", text: wordsA.slice(ai).join(" ") })
  if (bi < wordsB.length) ops.push({ type: "add", text: wordsB.slice(bi).join(" ") })

  return ops
}

/** Merge consecutive ops of the same type for cleaner rendering. */
function mergeOps(ops: DiffOp[]): DiffOp[] {
  const merged: DiffOp[] = []
  for (const op of ops) {
    const last = merged[merged.length - 1]
    if (last && last.type === op.type) last.text += " " + op.text
    else merged.push({ ...op })
  }
  return merged
}

// ── Client-side metrics ──────────────────────────────────────────────

function specEcho(prose: string, description: string): number {
  if (!prose || !description) return 0
  const bigrams = (text: string): Set<string> => {
    const words = text.toLowerCase().replace(/[^\w\s]/g, "").split(/\s+/).filter(Boolean)
    const set = new Set<string>()
    for (let i = 0; i < words.length - 1; i++) set.add(`${words[i]} ${words[i + 1]}`)
    return set
  }
  const specBigrams = bigrams(description)
  if (specBigrams.size === 0) return 0
  const proseBigrams = bigrams(prose)
  let overlap = 0
  for (const bg of specBigrams) if (proseBigrams.has(bg)) overlap++
  return overlap / specBigrams.size
}

function dialoguePct(prose: string): number {
  if (!prose) return 0
  const totalWords = prose.split(/\s+/).filter(Boolean).length
  if (totalWords === 0) return 0
  const matches = prose.match(/"[^"]*"/g) || []
  const dialogueWords = matches.reduce((sum, m) => sum + m.split(/\s+/).filter(Boolean).length, 0)
  return (dialogueWords / totalWords) * 100
}

// ── Types ────────────────────────────────────────────────────────────

interface OutlineData {
  chapterNumber: number
  title: string
  scenes: { description: string; characters: string[]; emotionalShift: string }[]
  setting?: string
  [key: string]: any
}

interface NovelData {
  novel: NovelListItem
  chapters: ChapterData[]
  outlines: OutlineData[]
  beats: BeatData[]
}

interface BeatMetrics {
  echo: number
  dialogue: number
  wordCount: number
  descWords: number
}

type ViewMode = "side" | "diff" | "unified"

// ── Component ────────────────────────────────────────────────────────

export function ComparePage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [novels, setNovels] = useState<NovelListItem[]>([])
  const [dataA, setDataA] = useState<NovelData | null>(null)
  const [dataB, setDataB] = useState<NovelData | null>(null)
  const [loadingA, setLoadingA] = useState(false)
  const [loadingB, setLoadingB] = useState(false)

  // Read state from URL
  const idA = searchParams.get("a") ?? ""
  const idB = searchParams.get("b") ?? ""
  const activeChapter = parseInt(searchParams.get("ch") ?? "1") || 1
  const activeBeatParam = searchParams.get("beat")
  const activeBeat = activeBeatParam !== null ? parseInt(activeBeatParam) : null
  const viewMode = (searchParams.get("view") ?? "diff") as ViewMode

  const updateParams = (updates: Record<string, string | null>) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev)
      for (const [k, v] of Object.entries(updates)) {
        if (v === null) next.delete(k)
        else next.set(k, v)
      }
      return next
    }, { replace: true })
  }

  useEffect(() => {
    listNovels().then(r => {
      setNovels(r.novels)
      // Auto-load novels from URL params on mount
      if (idA) loadNovel(idA, "A", r.novels)
      if (idB) loadNovel(idB, "B", r.novels)
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const loadNovel = async (novelId: string, side: "A" | "B", novelsList?: NovelListItem[]) => {
    const setLoading = side === "A" ? setLoadingA : setLoadingB
    const setData = side === "A" ? setDataA : setDataB
    if (!novelId) { setData(null); return }
    setLoading(true)
    try {
      const list = novelsList ?? novels
      const novel = list.find(n => n.id === novelId)!
      const [chapters, outlines, beats] = await Promise.all([
        getAllChapters(novelId),
        getOutlines(novelId),
        getBeats(novelId),
      ])
      setData({ novel, chapters, outlines, beats })
    } catch (err) {
      console.error(`Failed to load novel ${novelId}:`, err)
      setData(null)
    } finally {
      setLoading(false)
    }
  }

  const handlePickA = (id: string) => { updateParams({ a: id || null, ch: "1", beat: null }); loadNovel(id, "A") }
  const handlePickB = (id: string) => { updateParams({ b: id || null, ch: "1", beat: null }); loadNovel(id, "B") }

  const maxChapters = Math.max(dataA?.chapters.length ?? 0, dataB?.chapters.length ?? 0)

  const getChapterBeats = (data: NovelData | null) => {
    if (!data) return { outline: undefined as OutlineData | undefined, beats: [] as BeatData[] }
    const outline = data.outlines.find(o => o.chapterNumber === activeChapter)
    const beats = data.beats
      .filter(b => b.chapter === activeChapter)
      .sort((a, b) => a.beatIndex - b.beatIndex)
    return { outline, beats }
  }

  const chA = getChapterBeats(dataA)
  const chB = getChapterBeats(dataB)
  const maxBeats = Math.max(chA.outline?.scenes?.length ?? 0, chB.outline?.scenes?.length ?? 0)

  const beatMetrics = (beat: BeatData | undefined, scene: { description: string } | undefined): BeatMetrics => ({
    echo: specEcho(beat?.prose ?? "", scene?.description ?? ""),
    dialogue: dialoguePct(beat?.prose ?? ""),
    wordCount: beat?.wordCount ?? 0,
    descWords: scene ? scene.description.split(/\s+/).filter(Boolean).length : 0,
  })

  const chapterAgg = (data: NovelData | null) => {
    const { outline, beats } = getChapterBeats(data)
    if (!outline || beats.length === 0) return null
    const scenes = outline.scenes ?? []
    const metrics = beats.map(b => beatMetrics(b, scenes[b.beatIndex]))
    return {
      avgEcho: metrics.reduce((s, m) => s + m.echo, 0) / metrics.length,
      avgDialogue: metrics.reduce((s, m) => s + m.dialogue, 0) / metrics.length,
      totalWords: metrics.reduce((s, m) => s + m.wordCount, 0),
      avgDescWords: metrics.reduce((s, m) => s + m.descWords, 0) / metrics.length,
      beatCount: beats.length,
    }
  }

  const aggA = chapterAgg(dataA)
  const aggB = chapterAgg(dataB)

  // Same-seed detection
  const sameSeed = dataA && dataB &&
    dataA.novel.seed?.premise === dataB.novel.seed?.premise &&
    dataA.novel.seed?.genre === dataB.novel.seed?.genre

  const novelLabel = (n: NovelListItem) => {
    const d = new Date(n.createdAt)
    const date = `${d.getMonth() + 1}/${d.getDate()}`
    const premise = n.seed?.premise ?? ""
    const snippet = premise.length > 50 ? premise.slice(0, 50) + "..." : premise
    return `${n.id.slice(-6)} | ${n.seed?.genre ?? "?"} | ${date} | ${snippet}`
  }

  const beatsToShow = activeBeat !== null ? [activeBeat] : Array.from({ length: maxBeats }, (_, i) => i)

  return (
    <div className="compare-page">
      {/* ── Header row: pickers + view mode ── */}
      <div className="compare-pickers">
        <div className="compare-picker">
          <label className="compare-picker-label">Novel A</label>
          <select className="compare-select" value={idA} onChange={e => handlePickA(e.target.value)}>
            <option value="">Select novel...</option>
            {novels.map(n => <option key={n.id} value={n.id}>{novelLabel(n)}</option>)}
          </select>
        </div>
        <div className="compare-picker">
          <label className="compare-picker-label">Novel B</label>
          <select className="compare-select" value={idB} onChange={e => handlePickB(e.target.value)}>
            <option value="">Select novel...</option>
            {novels.map(n => <option key={n.id} value={n.id}>{novelLabel(n)}</option>)}
          </select>
        </div>
      </div>

      {sameSeed && <div className="compare-same-seed">Same seed detected — beats are aligned</div>}

      {/* ── Controls row: chapter, beat, view mode ── */}
      <div className="compare-controls">
        {maxChapters > 0 && (
          <div className="compare-chapter-nav">
            <span className="compare-nav-label">Ch:</span>
            {Array.from({ length: maxChapters }, (_, i) => i + 1).map(ch => (
              <button
                key={ch}
                className={`compare-nav-btn ${activeChapter === ch ? "active" : ""}`}
                onClick={() => updateParams({ ch: String(ch), beat: null })}
              >
                {ch}
              </button>
            ))}
          </div>
        )}
        {maxBeats > 0 && (
          <div className="compare-beat-nav">
            <span className="compare-nav-label">Beat:</span>
            <button
              className={`compare-nav-btn ${activeBeat === null ? "active" : ""}`}
              onClick={() => updateParams({ beat: null })}
            >
              All
            </button>
            {Array.from({ length: maxBeats }, (_, i) => i).map(bi => (
              <button
                key={bi}
                className={`compare-nav-btn ${activeBeat === bi ? "active" : ""}`}
                onClick={() => updateParams({ beat: String(bi) })}
              >
                {bi + 1}
              </button>
            ))}
          </div>
        )}
        <div className="compare-view-toggle">
          <span className="compare-nav-label">View:</span>
          {(["side", "diff", "unified"] as ViewMode[]).map(mode => (
            <button
              key={mode}
              className={`compare-nav-btn ${viewMode === mode ? "active" : ""}`}
              onClick={() => updateParams({ view: mode })}
            >
              {mode === "side" ? "Side" : mode === "diff" ? "Diff" : "Unified"}
            </button>
          ))}
        </div>
      </div>

      {/* ── Chapter metrics summary ── */}
      {(aggA || aggB) && (
        <div className="compare-metrics-bar">
          <table className="compare-metrics-table">
            <thead>
              <tr>
                <th></th>
                <th>Beats</th>
                <th>Avg Echo</th>
                <th>Avg Dlg%</th>
                <th>Total Words</th>
                <th>Avg Desc W</th>
              </tr>
            </thead>
            <tbody>
              {aggA && <MetricsRow label="A" agg={aggA} />}
              {aggB && <MetricsRow label="B" agg={aggB} />}
              {aggA && aggB && <DeltaRow a={aggA} b={aggB} />}
            </tbody>
          </table>
        </div>
      )}

      {(loadingA || loadingB) && <div className="compare-loading">Loading...</div>}

      {/* ── Beat rows ── */}
      {!loadingA && !loadingB && maxBeats > 0 && (
        <div className="compare-beats">
          {beatsToShow.map(bi => (
            <BeatRow
              key={bi}
              bi={bi}
              sceneA={chA.outline?.scenes?.[bi]}
              sceneB={chB.outline?.scenes?.[bi]}
              beatA={chA.beats.find(b => b.beatIndex === bi)}
              beatB={chB.beats.find(b => b.beatIndex === bi)}
              beatMetrics={beatMetrics}
              viewMode={viewMode}
            />
          ))}
        </div>
      )}

      {!loadingA && !loadingB && maxChapters === 0 && (idA || idB) && (
        <div className="compare-empty">Select two novels to compare</div>
      )}
      {!loadingA && !loadingB && maxChapters > 0 && maxBeats === 0 && (
        <div className="compare-empty">No beat data available for chapter {activeChapter}</div>
      )}
    </div>
  )
}

// ── Metrics rows ────────────────────────────────────────────────────

function MetricsRow({ label, agg }: { label: string; agg: ReturnType<typeof Object> & { avgEcho: number; avgDialogue: number; totalWords: number; avgDescWords: number; beatCount: number } }) {
  return (
    <tr>
      <td className="compare-metrics-label">{label}</td>
      <td>{agg.beatCount}</td>
      <td className={agg.avgEcho < 0.20 ? "metric-good" : "metric-warn"}>{(agg.avgEcho * 100).toFixed(1)}%</td>
      <td className={agg.avgDialogue > 20 ? "metric-good" : "metric-warn"}>{agg.avgDialogue.toFixed(1)}%</td>
      <td>{agg.totalWords.toLocaleString()}</td>
      <td className={agg.avgDescWords < 30 ? "metric-good" : "metric-warn"}>{agg.avgDescWords.toFixed(1)}</td>
    </tr>
  )
}

function DeltaRow({ a, b }: { a: { avgEcho: number; avgDialogue: number; totalWords: number; avgDescWords: number }; b: typeof a }) {
  const fmt = (val: number, pct = false) => {
    const s = pct ? (val * 100).toFixed(1) + "%" : val.toFixed(1)
    return val > 0 ? `+${s}` : s
  }
  return (
    <tr className="compare-delta-row">
      <td className="compare-metrics-label">B-A</td>
      <td></td>
      <td className={b.avgEcho - a.avgEcho < 0 ? "metric-good" : "metric-warn"}>{fmt(b.avgEcho - a.avgEcho, true)}</td>
      <td className={b.avgDialogue - a.avgDialogue > 0 ? "metric-good" : "metric-warn"}>{fmt(b.avgDialogue - a.avgDialogue)}%</td>
      <td>{fmt(b.totalWords - a.totalWords)}</td>
      <td className={b.avgDescWords - a.avgDescWords < 0 ? "metric-good" : "metric-warn"}>{fmt(b.avgDescWords - a.avgDescWords)}</td>
    </tr>
  )
}

// ── Beat row (dispatches to side/diff/unified) ──────────────────────

type Scene = { description: string; characters: string[]; emotionalShift: string }

function BeatRow({ bi, sceneA, sceneB, beatA, beatB, beatMetrics: bm, viewMode }: {
  bi: number
  sceneA: Scene | undefined
  sceneB: Scene | undefined
  beatA: BeatData | undefined
  beatB: BeatData | undefined
  beatMetrics: (beat: BeatData | undefined, scene: Scene | undefined) => BeatMetrics
  viewMode: ViewMode
}) {
  const mA = bm(beatA, sceneA)
  const mB = bm(beatB, sceneB)

  // Memoize diff computation
  const proseDiff = useMemo(() => {
    if (viewMode === "side") return null
    const a = beatA?.prose ?? ""
    const b = beatB?.prose ?? ""
    if (!a && !b) return null
    return mergeOps(wordDiff(a, b))
  }, [viewMode, beatA?.prose, beatB?.prose])

  const specDiff = useMemo(() => {
    if (viewMode === "side") return null
    const a = sceneA?.description ?? ""
    const b = sceneB?.description ?? ""
    if (a === b) return null // identical specs — no diff needed
    if (!a && !b) return null
    return mergeOps(wordDiff(a, b))
  }, [viewMode, sceneA?.description, sceneB?.description])

  return (
    <div className="compare-beat-row">
      <div className="compare-beat-header">
        <span className="compare-beat-number">Beat {bi + 1}</span>
        <div className="compare-beat-header-metrics">
          <MetricsBadges label="A" m={mA} />
          <MetricsBadges label="B" m={mB} />
        </div>
      </div>

      {/* Spec comparison */}
      {(sceneA || sceneB) && (
        <div className="compare-spec-row">
          {viewMode === "side" ? (
            <div className="compare-spec-columns">
              <SpecBlock scene={sceneA} />
              <SpecBlock scene={sceneB} />
            </div>
          ) : specDiff ? (
            <div className="compare-spec-diff">
              <div className="compare-spec-label">Spec diff</div>
              <DiffRender ops={specDiff} mode={viewMode} />
            </div>
          ) : (
            <div className="compare-spec-identical">
              <div className="compare-spec-label">Spec (identical)</div>
              <div className="compare-spec-text">{sceneA?.description ?? sceneB?.description}</div>
            </div>
          )}
        </div>
      )}

      {/* Prose comparison */}
      {viewMode === "side" ? (
        <div className="compare-prose-columns">
          <div className="compare-beat-prose">{beatA?.prose ?? <span className="compare-no-data">No prose</span>}</div>
          <div className="compare-beat-prose">{beatB?.prose ?? <span className="compare-no-data">No prose</span>}</div>
        </div>
      ) : proseDiff ? (
        <div className="compare-prose-diff">
          <DiffRender ops={proseDiff} mode={viewMode} />
        </div>
      ) : (
        <div className="compare-prose-diff">
          <span className="compare-no-data">{!beatA?.prose && !beatB?.prose ? "No prose" : "Identical"}</span>
        </div>
      )}
    </div>
  )
}

// ── Reusable sub-components ─────────────────────────────────────────

function MetricsBadges({ label, m }: { label: string; m: BeatMetrics }) {
  return (
    <div className="compare-beat-badge-group">
      <span className="compare-badge-label">{label}</span>
      <span className={`compare-badge ${m.echo < 0.20 ? "badge-good" : "badge-warn"}`}>
        E{(m.echo * 100).toFixed(0)}%
      </span>
      <span className={`compare-badge ${m.dialogue > 20 ? "badge-good" : "badge-warn"}`}>
        D{m.dialogue.toFixed(0)}%
      </span>
      <span className="compare-badge">{m.wordCount}w</span>
    </div>
  )
}

function SpecBlock({ scene }: { scene: Scene | undefined }) {
  if (!scene) return <div className="compare-spec-block compare-no-data">No spec</div>
  return (
    <div className="compare-spec-block">
      <div className="compare-spec-text">{scene.description}</div>
      {scene.characters.length > 0 && <div className="compare-spec-chars">{scene.characters.join(", ")}</div>}
      {scene.emotionalShift && <div className="compare-spec-shift">{scene.emotionalShift}</div>}
    </div>
  )
}

function DiffRender({ ops, mode }: { ops: DiffOp[]; mode: "diff" | "unified" }) {
  if (mode === "unified") {
    // Interleaved: deletions then additions, with equal text flowing through
    const elements: ReactNode[] = []
    for (let i = 0; i < ops.length; i++) {
      const op = ops[i]
      if (op.type === "equal") elements.push(<span key={i} className="diff-equal">{op.text} </span>)
      else if (op.type === "del") elements.push(<span key={i} className="diff-del">{op.text} </span>)
      else elements.push(<span key={i} className="diff-add">{op.text} </span>)
    }
    return <div className="diff-unified">{elements}</div>
  }

  // "diff" mode: side-by-side with alignment, highlighting changed words
  const leftParts: ReactNode[] = []
  const rightParts: ReactNode[] = []
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i]
    if (op.type === "equal") {
      leftParts.push(<span key={i} className="diff-equal">{op.text} </span>)
      rightParts.push(<span key={i} className="diff-equal">{op.text} </span>)
    } else if (op.type === "del") {
      leftParts.push(<span key={i} className="diff-del">{op.text} </span>)
    } else {
      rightParts.push(<span key={i} className="diff-add">{op.text} </span>)
    }
  }

  return (
    <div className="diff-side-by-side">
      <div className="diff-col diff-col-a">{leftParts}</div>
      <div className="diff-col diff-col-b">{rightParts}</div>
    </div>
  )
}
