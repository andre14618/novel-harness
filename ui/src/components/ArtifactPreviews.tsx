import { useCallback, useEffect, useState } from "react"
import { getCharacters, getOutlines, getStorySpine, getWorldBible } from "../api"

type ArtifactKey = "world" | "characters" | "spine" | "outlines"

interface Props {
  novelId: string | null
  refreshKey: number
}

interface Artifacts {
  world: any | null
  characters: any[] | null
  spine: any | null
  outlines: any[] | null
}

const EMPTY: Artifacts = { world: null, characters: null, spine: null, outlines: null }

export function ArtifactPreviews({ novelId, refreshKey }: Props) {
  const [artifacts, setArtifacts] = useState<Artifacts>(EMPTY)
  const [expanded, setExpanded] = useState<ArtifactKey | null>(null)
  const [loading, setLoading] = useState(false)

  const fetchAll = useCallback(async (id: string) => {
    setLoading(true)
    const [world, characters, spine, outlines] = await Promise.allSettled([
      getWorldBible(id),
      getCharacters(id),
      getStorySpine(id),
      getOutlines(id),
    ])
    setArtifacts({
      world:      world.status      === "fulfilled" ? world.value      : null,
      characters: characters.status === "fulfilled" ? characters.value : null,
      spine:      spine.status      === "fulfilled" ? spine.value      : null,
      outlines:   outlines.status   === "fulfilled" ? outlines.value   : null,
    })
    setLoading(false)
  }, [])

  useEffect(() => {
    if (!novelId) { setArtifacts(EMPTY); return }
    fetchAll(novelId)
  }, [novelId, refreshKey, fetchAll])

  if (!novelId) return null

  const has = {
    world:      !!artifacts.world,
    characters: !!(artifacts.characters && artifacts.characters.length),
    spine:      !!artifacts.spine,
    outlines:   !!(artifacts.outlines && artifacts.outlines.length),
  }
  const anyArtifact = has.world || has.characters || has.spine || has.outlines
  if (!anyArtifact && !loading) return null

  const toggle = (k: ArtifactKey) => setExpanded(prev => prev === k ? null : k)

  return (
    <div className="artifact-previews">
      <div className="artifact-tabs">
        <TabButton label="World"      count={has.world ? 1 : 0}                          active={expanded === "world"}      disabled={!has.world}      onClick={() => toggle("world")} />
        <TabButton label="Characters" count={artifacts.characters?.length ?? 0}          active={expanded === "characters"} disabled={!has.characters} onClick={() => toggle("characters")} />
        <TabButton label="Plot"       count={has.spine ? 1 : 0}                          active={expanded === "spine"}      disabled={!has.spine}      onClick={() => toggle("spine")} />
        <TabButton label="Chapters"   count={artifacts.outlines?.length ?? 0}            active={expanded === "outlines"}   disabled={!has.outlines}   onClick={() => toggle("outlines")} />
      </div>
      {expanded === "world"      && artifacts.world      && <WorldPreview     world={artifacts.world} />}
      {expanded === "characters" && artifacts.characters && <CharactersPreview characters={artifacts.characters} />}
      {expanded === "spine"      && artifacts.spine      && <SpinePreview     spine={artifacts.spine} />}
      {expanded === "outlines"   && artifacts.outlines   && <OutlinesPreview  outlines={artifacts.outlines} />}
    </div>
  )
}

function TabButton(props: { label: string; count: number; active: boolean; disabled: boolean; onClick: () => void }) {
  return (
    <button
      className={`artifact-tab${props.active ? " active" : ""}${props.disabled ? " disabled" : ""}`}
      onClick={props.disabled ? undefined : props.onClick}
      disabled={props.disabled}
      title={props.disabled ? "Not generated yet" : ""}
    >
      {props.label}{props.count > 0 && <span className="artifact-tab-count">{props.count}</span>}
    </button>
  )
}

function WorldPreview({ world }: { world: any }) {
  const systems: any[] = world.systems ?? []
  const cultures: any[] = world.cultures ?? []
  const locations: any[] = world.locations ?? []
  return (
    <div className="artifact-body">
      {world.politicalStructure && <Section title="Political structure"><p>{world.politicalStructure}</p></Section>}
      {world.technologyConstraints && <Section title="Technology / magic"><p>{world.technologyConstraints}</p></Section>}
      {systems.length > 0 && <Section title={`Systems (${systems.length})`}>
        <ul>{systems.map((s, i) => <li key={i}><strong>{s.name}</strong>{s.description ? ` — ${s.description}` : ""}</li>)}</ul>
      </Section>}
      {cultures.length > 0 && <Section title={`Cultures (${cultures.length})`}>
        <ul>{cultures.map((c, i) => <li key={i}><strong>{c.name}</strong>{c.description ? ` — ${c.description}` : ""}</li>)}</ul>
      </Section>}
      {locations.length > 0 && <Section title={`Locations (${locations.length})`}>
        <ul>{locations.map((l, i) => <li key={i}><strong>{l.name}</strong>{l.description ? ` — ${l.description}` : ""}</li>)}</ul>
      </Section>}
      {Array.isArray(world.socialCustoms) && world.socialCustoms.length > 0 && (
        <Section title="Social customs"><ul>{world.socialCustoms.map((c: string, i: number) => <li key={i}>{c}</li>)}</ul></Section>
      )}
    </div>
  )
}

function CharactersPreview({ characters }: { characters: any[] }) {
  return (
    <div className="artifact-body">
      {characters.map((c, i) => (
        <div key={c.id ?? i} className="artifact-character">
          <div className="artifact-character-head">
            <strong>{c.name}</strong>
            {c.role && <span className="artifact-badge">{c.role}</span>}
          </div>
          {c.goals   && <div><em>Wants:</em> {c.goals}</div>}
          {c.fears   && <div><em>Fears:</em> {c.fears}</div>}
          {c.internalConflict && <div><em>Conflict:</em> {c.internalConflict}</div>}
          {Array.isArray(c.traits) && c.traits.length > 0 && (
            <div className="artifact-traits">{c.traits.map((t: string, j: number) => <span key={j} className="artifact-trait">{t}</span>)}</div>
          )}
        </div>
      ))}
    </div>
  )
}

function SpinePreview({ spine }: { spine: any }) {
  const acts: any[] = spine.acts ?? []
  return (
    <div className="artifact-body">
      {spine.logline && <Section title="Logline"><p>{spine.logline}</p></Section>}
      {spine.theme   && <Section title="Theme"><p>{spine.theme}</p></Section>}
      {acts.length > 0 && (
        <Section title="Acts">
          <ol>{acts.map((a, i) => (
            <li key={i}>
              <strong>{a.title ?? `Act ${i + 1}`}</strong>
              {a.summary && <> — {a.summary}</>}
            </li>
          ))}</ol>
        </Section>
      )}
    </div>
  )
}

function OutlinesPreview({ outlines }: { outlines: any[] }) {
  return (
    <div className="artifact-body">
      {outlines.map((o, i) => {
        const scenes: any[] = o.scenes ?? []
        return (
          <div key={i} className="artifact-chapter">
            <div className="artifact-chapter-head">
              <strong>Chapter {o.chapterNumber ?? i + 1}{o.title ? `: ${o.title}` : ""}</strong>
              {o.povCharacter && <span className="artifact-badge">POV: {o.povCharacter}</span>}
            </div>
            {o.purpose && <div className="artifact-chapter-purpose">{o.purpose}</div>}
            {scenes.length > 0 && (
              <ol className="artifact-scenes">
                {scenes.map((s, j) => <li key={j}>{s.description ?? s.summary ?? String(s)}</li>)}
              </ol>
            )}
          </div>
        )
      })}
    </div>
  )
}

function Section(props: { title: string; children: React.ReactNode }) {
  return (
    <div className="artifact-section">
      <div className="artifact-section-title">{props.title}</div>
      {props.children}
    </div>
  )
}
