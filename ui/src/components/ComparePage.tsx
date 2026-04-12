import { useEffect, useState } from "react"
import { listNovels, getAllChapters, getOutlines, type ChapterData, type NovelListItem } from "../api"

// ── Client-side metrics ──────────────────────────────────────────────

/** Bigram overlap between beat descriptions and prose (0-1). */
function specEcho(prose: string, beats: { description: string }[]): number {
  if (!prose || beats.length === 0) return 0
  const bigrams = (text: string): Set<string> => {
    const words = text.toLowerCase().replace(/[^\w\s]/g, "").split(/\s+/).filter(Boolean)
    const set = new Set<string>()
    for (let i = 0; i < words.length - 1; i++) set.add(`${words[i]} ${words[i + 1]}`)
    return set
  }
  const specBigrams = new Set<string>()
  for (const b of beats) for (const bg of bigrams(b.description)) specBigrams.add(bg)
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

/** Average word count of beat descriptions. */
function avgDescWords(beats: { description: string }[]): number {
  if (beats.length === 0) return 0
  const total = beats.reduce((sum, b) => sum + b.description.split(/\s+/).filter(Boolean).length, 0)
  return total / beats.length
}

// ── Types ────────────────────────────────────────────────────────────

interface OutlineData {
  chapterNumber: number
  title: string
  scenes: { description: string; characters: string[]; emotionalShift: string }[]
  [key: string]: any
}

interface NovelData {
  novel: NovelListItem
  chapters: ChapterData[]
  outlines: OutlineData[]
}

interface ChapterMetrics {
  echo: number
  dialogue: number
  wordCount: number
  descWords: number
}

function computeChapterMetrics(chapter: ChapterData | undefined, outline: OutlineData | undefined): ChapterMetrics {
  const beats = outline?.scenes ?? []
  const prose = chapter?.prose ?? ""
  return {
    echo: specEcho(prose, beats),
    dialogue: dialoguePct(prose),
    wordCount: chapter?.wordCount ?? 0,
    descWords: avgDescWords(beats),
  }
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
      const [chapters, outlines] = await Promise.all([
        getAllChapters(novelId),
        getOutlines(novelId),
      ])
      setData({ novel, chapters, outlines })
    } catch (err) {
      console.error(`Failed to load novel ${novelId}:`, err)
      setData(null)
    } finally {
      setLoading(false)
    }
  }

  const handlePickA = (id: string) => { setIdA(id); setActiveChapter(1); loadNovel(id, "A") }
  const handlePickB = (id: string) => { setIdB(id); setActiveChapter(1); loadNovel(id, "B") }

  const maxChapters = Math.max(dataA?.chapters.length ?? 0, dataB?.chapters.length ?? 0)

  // Aggregate metrics
  const aggMetrics = (data: NovelData | null) => {
    if (!data || data.chapters.length === 0) return null
    const perCh = data.chapters.map(ch => {
      const outline = data.outlines.find(o => o.chapterNumber === ch.chapter)
      return computeChapterMetrics(ch, outline)
    })
    return {
      avgEcho: perCh.reduce((s, m) => s + m.echo, 0) / perCh.length,
      avgDialogue: perCh.reduce((s, m) => s + m.dialogue, 0) / perCh.length,
      avgWordCount: perCh.reduce((s, m) => s + m.wordCount, 0) / perCh.length,
      avgDescWords: perCh.reduce((s, m) => s + m.descWords, 0) / perCh.length,
      totalChapters: data.chapters.length,
    }
  }

  const metricsA = aggMetrics(dataA)
  const metricsB = aggMetrics(dataB)

  const novelLabel = (n: NovelListItem) => {
    const d = new Date(n.createdAt)
    const date = `${d.getMonth() + 1}/${d.getDate()}`
    const premise = n.seed?.premise ?? ""
    const snippet = premise.length > 60 ? premise.slice(0, 60) + "..." : premise
    return `${n.id.slice(0, 8)} | ${n.seed?.genre ?? "?"} | ${date} | ${snippet}`
  }

  const chapterA = dataA?.chapters.find(c => c.chapter === activeChapter)
  const chapterB = dataB?.chapters.find(c => c.chapter === activeChapter)
  const outlineA = dataA?.outlines.find(o => o.chapterNumber === activeChapter)
  const outlineB = dataB?.outlines.find(o => o.chapterNumber === activeChapter)
  const metricsChA = computeChapterMetrics(chapterA, outlineA)
  const metricsChB = computeChapterMetrics(chapterB, outlineB)

  return (
    <div className="compare-page">
      {/* ── Novel pickers ── */}
      <div className="compare-pickers">
        <div className="compare-picker">
          <label className="compare-picker-label">Novel A</label>
          <select
            className="compare-select"
            value={idA}
            onChange={e => handlePickA(e.target.value)}
          >
            <option value="">Select novel...</option>
            {novels.map(n => (
              <option key={n.id} value={n.id}>{novelLabel(n)}</option>
            ))}
          </select>
        </div>
        <div className="compare-picker">
          <label className="compare-picker-label">Novel B</label>
          <select
            className="compare-select"
            value={idB}
            onChange={e => handlePickB(e.target.value)}
          >
            <option value="">Select novel...</option>
            {novels.map(n => (
              <option key={n.id} value={n.id}>{novelLabel(n)}</option>
            ))}
          </select>
        </div>
      </div>

      {/* ── Metrics summary ── */}
      {(metricsA || metricsB) && (
        <div className="compare-metrics-bar">
          <table className="compare-metrics-table">
            <thead>
              <tr>
                <th></th>
                <th>Chapters</th>
                <th>Avg Echo</th>
                <th>Avg Dialogue%</th>
                <th>Avg Words/Ch</th>
                <th>Avg Desc Words</th>
              </tr>
            </thead>
            <tbody>
              {metricsA && (
                <tr>
                  <td className="compare-metrics-label">A</td>
                  <td>{metricsA.totalChapters}</td>
                  <td>{(metricsA.avgEcho * 100).toFixed(1)}%</td>
                  <td>{metricsA.avgDialogue.toFixed(1)}%</td>
                  <td>{Math.round(metricsA.avgWordCount).toLocaleString()}</td>
                  <td>{metricsA.avgDescWords.toFixed(1)}</td>
                </tr>
              )}
              {metricsB && (
                <tr>
                  <td className="compare-metrics-label">B</td>
                  <td>{metricsB.totalChapters}</td>
                  <td>{(metricsB.avgEcho * 100).toFixed(1)}%</td>
                  <td>{metricsB.avgDialogue.toFixed(1)}%</td>
                  <td>{Math.round(metricsB.avgWordCount).toLocaleString()}</td>
                  <td>{metricsB.avgDescWords.toFixed(1)}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Chapter selector ── */}
      {maxChapters > 0 && (
        <div className="compare-chapter-nav">
          {Array.from({ length: maxChapters }, (_, i) => i + 1).map(ch => (
            <button
              key={ch}
              className={`compare-chapter-btn ${activeChapter === ch ? "active" : ""}`}
              onClick={() => setActiveChapter(ch)}
            >
              {ch}
            </button>
          ))}
        </div>
      )}

      {/* ── Side-by-side content ── */}
      {(loadingA || loadingB) && (
        <div className="compare-loading">Loading...</div>
      )}

      {maxChapters > 0 && !loadingA && !loadingB && (
        <div className="compare-columns">
          <CompareColumn
            label="A"
            chapter={chapterA}
            outline={outlineA}
            metrics={metricsChA}
          />
          <CompareColumn
            label="B"
            chapter={chapterB}
            outline={outlineB}
            metrics={metricsChB}
          />
        </div>
      )}

      {!loadingA && !loadingB && maxChapters === 0 && (idA || idB) && (
        <div className="compare-empty">Select two novels to compare</div>
      )}
    </div>
  )
}

// ── Column sub-component ─────────────────────────────────────────────

function CompareColumn({ label, chapter, outline, metrics }: {
  label: string
  chapter: ChapterData | undefined
  outline: OutlineData | undefined
  metrics: ChapterMetrics
}) {
  const [beatsOpen, setBeatsOpen] = useState(false)
  const beats = outline?.scenes ?? []

  if (!chapter && !outline) {
    return (
      <div className="compare-col">
        <div className="compare-col-header">
          <span className="compare-col-label">{label}</span>
        </div>
        <div className="compare-col-empty">No data for this chapter</div>
      </div>
    )
  }

  return (
    <div className="compare-col">
      <div className="compare-col-header">
        <span className="compare-col-label">{label}</span>
        {outline && <span className="compare-col-title">{outline.title}</span>}
      </div>

      {/* Metrics badges */}
      <div className="compare-col-metrics">
        <span className="compare-badge">Echo {(metrics.echo * 100).toFixed(1)}%</span>
        <span className="compare-badge">Dialogue {metrics.dialogue.toFixed(1)}%</span>
        <span className="compare-badge">{metrics.wordCount.toLocaleString()}w</span>
        <span className="compare-badge">Desc {metrics.descWords.toFixed(1)}w</span>
      </div>

      {/* Beat descriptions — collapsible */}
      {beats.length > 0 && (
        <div className="compare-beats-section">
          <button
            className="compare-beats-toggle"
            onClick={() => setBeatsOpen(o => !o)}
          >
            {beatsOpen ? "Hide" : "Show"} beats ({beats.length})
          </button>
          {beatsOpen && (
            <div className="compare-beats-list">
              {beats.map((b, i) => (
                <div key={i} className="compare-beat">
                  <span className="compare-beat-idx">{i + 1}</span>
                  <div className="compare-beat-body">
                    <div className="compare-beat-desc">{b.description}</div>
                    {b.characters.length > 0 && (
                      <div className="compare-beat-chars">{b.characters.join(", ")}</div>
                    )}
                    {b.emotionalShift && (
                      <div className="compare-beat-shift">{b.emotionalShift}</div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Prose */}
      {chapter ? (
        <div className="compare-prose prose-content">{chapter.prose}</div>
      ) : (
        <div className="compare-col-empty">No prose for this chapter</div>
      )}
    </div>
  )
}
