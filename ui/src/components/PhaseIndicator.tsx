const PHASES = ["concept", "planning", "drafting", "validation", "done"] as const

interface Props {
  currentPhase: string
  pendingGate: boolean
}

export function PhaseIndicator({ currentPhase, pendingGate }: Props) {
  const currentIdx = PHASES.indexOf(currentPhase as any)

  return (
    <div className="phase-indicator">
      {PHASES.map((phase, i) => {
        let cls = "phase-step"
        if (i < currentIdx) cls += " completed"
        else if (i === currentIdx) {
          cls += " current"
          if (pendingGate) cls += " waiting"
        }
        return (
          <div key={phase} className={cls}>
            {phase}
          </div>
        )
      })}
    </div>
  )
}
