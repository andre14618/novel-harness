import { useEffect, useState } from "react"
import { listNovels, getAllChapters, getOutlines, getBeats, type BeatData, type ChapterData, type NovelListItem } from "../api"

// ── Client-side metrics ──────────────────────────────────────────────

/** Bigram overlap between a single beat description and its prose (0-1). */
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

/** Percentage of words inside double quotes. */
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

// ── Component ────────────────────────────────────────────────────────

export function ComparePage() {
  const [novels, setNovels] = useState<NovelListItem[]>([])
  const [idA, setIdA] = useState("")
  const [idB, setIdB] = useState("")
  const [dataA, setDataA] = useState<NovelData | null>(null)
  const [dataB, setDataB] = useState<NovelData | null>(null)
  const [loadingA, setLoadingA] = useState(false)
  const [loadingB, setLoadingB] = useState(false)
  const [activeChapter, setActiveChapter] = useState(1)
  const [activeBeat, setActiveBeat] = useState<number | null>(null) // null = show all beats

  useEffect(() => {
    listNovels().then(r => setNovels(r.novels))
  }, [])

  const loadNovel = async (novelId: string, side: "A" | "B") => {
    const setLoading = side === "A" ? setLoadingA : setLoadingB
    const setData = side === "A" ? setDataA : setDataB
    if (!novelId) { setData(null); return }
    setLoading(true)
    try {
      const novel = novels.find(n => n.id === novelId)!
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

  const handlePickA = (id: string) => { setIdA(id); setActiveChapter(1); setActiveBeat(null); loadNovel(id, "A") }
  const handlePickB = (id: string) => { setIdB(id); setActiveChapter(1); setActiveBeat(null); loadNovel(id, "B") }

  const maxChapters = Math.max(dataA?.chapters.length ?? 0, dataB?.chapters.length ?? 0)

  // Get beats for current chapter
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
  const maxBeats = Math.max(
    chA.outline?.scenes?.length ?? 0,
    chB.outline?.scenes?.length ?? 0,
  )

  // Compute per-beat metrics
  const beatMetrics = (beat: BeatData | undefined, scene: { description: string } | undefined): BeatMetrics => ({
    echo: specEcho(beat?.prose ?? "", scene?.description ?? ""),
    dialogue: dialoguePct(beat?.prose ?? ""),
    wordCount: beat?.wordCount ?? 0,
    descWords: scene ? scene.description.split(/\s+/).filter(Boolean).length : 0,
  })

  // Aggregate metrics for current chapter
  const chapterAgg = (data: NovelData | null) => {
    const { outline, beats } = getChapterBeats(data)
    if (!outline || beats.length === 0) return null
    const scenes = outline.scenes ?? []
    const metrics = beats.map(b => {
      const scene = scenes[b.beatIndex]
      return beatMetrics(b, scene)
    })
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

  const novelLabel = (n: NovelListItem) => {
    const d = new Date(n.createdAt)
    const date = `${d.getMonth() + 1}/${d.getDate()}`
    const premise = n.seed?.premise ?? ""
    const snippet = premise.length > 50 ? premise.slice(0, 50) + "..." : premise
    return `${n.id.slice(-6)} | ${n.seed?.genre ?? "?"} | ${date} | ${snippet}`
  }

  // Which beats to render
  const beatsToShow = activeBeat !== null ? [activeBeat] : Array.from({ length: maxBeats }, (_, i) => i)

  return (
    <div className="compare-page">
      {/* ── Novel pickers ── */}
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

      {/* ── Chapter selector ── */}
      {maxChapters > 0 && (
        <div className="compare-chapter-nav">
          <span className="compare-nav-label">Ch:</span>
          {Array.from({ length: maxChapters }, (_, i) => i + 1).map(ch => (
            <button
              key={ch}
              className={`compare-chapter-btn ${activeChapter === ch ? "active" : ""}`}
              onClick={() => { setActiveChapter(ch); setActiveBeat(null) }}
            >
              {ch}
            </button>
          ))}
        </div>
      )}

      {/* ── Beat selector ── */}
      {maxBeats > 0 && (
        <div className="compare-beat-nav">
          <span className="compare-nav-label">Beat:</span>
          <button
            className={`compare-beat-btn ${activeBeat === null ? "active" : ""}`}
            onClick={() => setActiveBeat(null)}
          >
            All
          </button>
          {Array.from({ length: maxBeats }, (_, i) => i).map(bi => (
            <button
              key={bi}
              className={`compare-beat-btn ${activeBeat === bi ? "active" : ""}`}
              onClick={() => setActiveBeat(bi)}
            >
              {bi + 1}
            </button>
          ))}
        </div>
      )}

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
              {aggA && (
                <tr>
                  <td className="compare-metrics-label">A</td>
                  <td>{aggA.beatCount}</td>
                  <td className={aggA.avgEcho < 0.20 ? "metric-good" : "metric-warn"}>{(aggA.avgEcho * 100).toFixed(1)}%</td>
                  <td className={aggA.avgDialogue > 20 ? "metric-good" : "metric-warn"}>{aggA.avgDialogue.toFixed(1)}%</td>
                  <td>{aggA.totalWords.toLocaleString()}</td>
                  <td className={aggA.avgDescWords < 30 ? "metric-good" : "metric-warn"}>{aggA.avgDescWords.toFixed(1)}</td>
                </tr>
              )}
              {aggB && (
                <tr>
                  <td className="compare-metrics-label">B</td>
                  <td>{aggB.beatCount}</td>
                  <td className={aggB.avgEcho < 0.20 ? "metric-good" : "metric-warn"}>{(aggB.avgEcho * 100).toFixed(1)}%</td>
                  <td className={aggB.avgDialogue > 20 ? "metric-good" : "metric-warn"}>{aggB.avgDialogue.toFixed(1)}%</td>
                  <td>{aggB.totalWords.toLocaleString()}</td>
                  <td className={aggB.avgDescWords < 30 ? "metric-good" : "metric-warn"}>{aggB.avgDescWords.toFixed(1)}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Loading ── */}
      {(loadingA || loadingB) && <div className="compare-loading">Loading...</div>}

      {/* ── Beat-level comparison ── */}
      {!loadingA && !loadingB && maxBeats > 0 && (
        <div className="compare-beats">
          {beatsToShow.map(bi => {
            const sceneA = chA.outline?.scenes?.[bi]
            const sceneB = chB.outline?.scenes?.[bi]
            const beatA = chA.beats.find(b => b.beatIndex === bi)
            const beatB = chB.beats.find(b => b.beatIndex === bi)
            const mA = beatMetrics(beatA, sceneA)
            const mB = beatMetrics(beatB, sceneB)

            return (
              <div key={bi} className="compare-beat-row">
                <div className="compare-beat-header">
                  <span className="compare-beat-number">Beat {bi + 1}</span>
                </div>
                <div className="compare-beat-columns">
                  <BeatColumn
                    label="A"
                    scene={sceneA}
                    beat={beatA}
                    metrics={mA}
                  />
                  <BeatColumn
                    label="B"
                    scene={sceneB}
                    beat={beatB}
                    metrics={mB}
                  />
                </div>
              </div>
            )
          })}
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

// ── Beat column sub-component ───────────────────────────────────────

function BeatColumn({ label, scene, beat, metrics }: {
  label: string
  scene: { description: string; characters: string[]; emotionalShift: string } | undefined
  beat: BeatData | undefined
  metrics: BeatMetrics
}) {
  if (!scene && !beat) {
    return (
      <div className="compare-beat-col">
        <div className="compare-beat-col-header">
          <span className="compare-col-label">{label}</span>
        </div>
        <div className="compare-col-empty">No data</div>
      </div>
    )
  }

  return (
    <div className="compare-beat-col">
      <div className="compare-beat-col-header">
        <span className="compare-col-label">{label}</span>
        <div className="compare-beat-badges">
          <span className={`compare-badge ${metrics.echo < 0.20 ? "badge-good" : "badge-warn"}`}>
            Echo {(metrics.echo * 100).toFixed(0)}%
          </span>
          <span className={`compare-badge ${metrics.dialogue > 20 ? "badge-good" : "badge-warn"}`}>
            Dlg {metrics.dialogue.toFixed(0)}%
          </span>
          <span className="compare-badge">{metrics.wordCount}w</span>
          <span className={`compare-badge ${metrics.descWords < 30 ? "badge-good" : "badge-warn"}`}>
            Desc {metrics.descWords}w
          </span>
        </div>
      </div>

      {/* Beat spec */}
      {scene && (
        <div className="compare-beat-spec">
          <div className="compare-spec-label">Spec</div>
          <div className="compare-spec-text">{scene.description}</div>
          {scene.characters.length > 0 && (
            <div className="compare-spec-chars">{scene.characters.join(", ")}</div>
          )}
          {scene.emotionalShift && (
            <div className="compare-spec-shift">{scene.emotionalShift}</div>
          )}
        </div>
      )}

      {/* Beat prose output */}
      {beat ? (
        <div className="compare-beat-prose">{beat.prose}</div>
      ) : (
        <div className="compare-col-empty">No prose output</div>
      )}
    </div>
  )
}
