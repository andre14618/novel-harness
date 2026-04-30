/**
 * PipelineFlow — horizontal pipeline diagram showing the novel's phases and
 * which agent is currently active. Designed as the visual anchor for a live
 * novel write: the reader can glance up and immediately see where the pipeline
 * is and what's happening right now.
 */

import { agentShortLabel } from "../agent-labels"

const PHASES: { id: string; label: string; agents: string[] }[] = [
  { id: "concept",    label: "Concept",    agents: ["world-builder", "character-agent", "plotter"] },
  { id: "planning",   label: "Planning",   agents: ["planning-plotter", "planning-beats"] },
  { id: "drafting",   label: "Drafting",   agents: ["beat-writer", "reference-resolver", "adherence-events", "halluc-ungrounded", "chapter-plan-checker", "continuity", "lint-fixer"] },
  { id: "validation", label: "Validation", agents: [] },
  { id: "done",       label: "Done",       agents: [] },
]

interface Props {
  currentPhase: string
  activeAgents: Set<string>
  completedAgents: Set<string>
}

export function PipelineFlow({ currentPhase, activeAgents, completedAgents }: Props) {
  const currentIdx = PHASES.findIndex(p => p.id === currentPhase)

  return (
    <div className="pipeline-flow">
      <div className="pipeline-phases">
        {PHASES.map((phase, i) => {
          let cls = "pf-phase"
          if (i < currentIdx) cls += " completed"
          else if (i === currentIdx) cls += " current"
          else cls += " upcoming"
          return (
            <div key={phase.id} className={cls}>
              <div className="pf-phase-dot" />
              <div className="pf-phase-label">{phase.label}</div>
            </div>
          )
        })}
      </div>

      {currentIdx >= 0 && PHASES[currentIdx].agents.length > 0 && (
        <div className="pipeline-agents">
          {PHASES[currentIdx].agents.map(agent => {
            const active = activeAgents.has(agent)
            const done = completedAgents.has(agent)
            let cls = "agent-pill"
            if (active) cls += " active"
            else if (done) cls += " done"
            else cls += " idle"
            return (
              <div key={agent} className={cls}>
                <span className="agent-pill-dot" />
                {agentShortLabel(agent)}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
