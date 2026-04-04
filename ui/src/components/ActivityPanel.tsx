import { useEffect, useState, useRef } from "react"
import type { SSEEvent } from "../api"

interface Props {
  events: SSEEvent[]
  active: boolean
  pendingGate: boolean
}

interface StepState {
  step: string
  status: string
  chapter?: number
  attempt?: number
  wordCount?: number
  issueCount?: number
}

const STEP_LABELS: Record<string, string> = {
  "world-builder": "Building world bible",
  "character-agent": "Creating characters",
  "plotter": "Plotting story spine",
  "planning-plotter": "Generating chapter outlines",
  "writer": "Writing chapter",
  "continuity": "Checking continuity",
  "state-extraction": "Extracting facts & state",
  "cross-chapter-continuity": "Cross-chapter continuity check",
  "prose-quality": "Prose quality check",
  "rewriter": "Rewriting chapter",
  "drafting": "Drafting",
}

export function ActivityPanel({ events, active, pendingGate }: Props) {
  const [steps, setSteps] = useState<StepState[]>([])
  const [elapsed, setElapsed] = useState(0)
  const timerRef = useRef<ReturnType<typeof setInterval>>(undefined)
  const startRef = useRef<number>(Date.now())

  // Track steps from SSE events
  useEffect(() => {
    const latestByStep = new Map<string, StepState>()

    for (const e of events) {
      if (e.type !== "progress") continue
      const d = e.data
      const key = d.chapter ? `${d.step}-ch${d.chapter}` : d.step as string

      latestByStep.set(key, {
        step: d.step as string,
        status: d.status as string,
        chapter: d.chapter as number | undefined,
        attempt: d.attempt as number | undefined,
        wordCount: d.wordCount as number | undefined,
        issueCount: d.issueCount as number | undefined,
      })
    }

    setSteps([...latestByStep.values()])
  }, [events])

  // Elapsed timer
  useEffect(() => {
    if (active && !pendingGate) {
      startRef.current = Date.now() - elapsed * 1000
      timerRef.current = setInterval(() => {
        setElapsed(Math.floor((Date.now() - startRef.current) / 1000))
      }, 1000)
    } else {
      clearInterval(timerRef.current)
    }
    return () => clearInterval(timerRef.current)
  }, [active, pendingGate])

  if (!active && steps.length === 0) return null

  const runningSteps = steps.filter(s =>
    s.status === "running" || s.status === "retrying" || s.status === "revising"
  )
  const completedSteps = steps.filter(s =>
    s.status === "complete" || s.status === "approved"
  )
  const currentStep = runningSteps[runningSteps.length - 1]

  const showSpinner = active && !pendingGate && (runningSteps.length > 0 || steps.length === 0)

  return (
    <div className="activity-panel">
      {/* Current activity header */}
      <div className="activity-header">
        {showSpinner && <div className="spinner" />}
        <span className="activity-label">
          {pendingGate
            ? "Waiting for review"
            : active
              ? currentStep
                ? formatStepLabel(currentStep)
                : "Starting pipeline..."
              : steps.length > 0
                ? "Pipeline idle"
                : ""}
        </span>
        {active && (
          <span className="activity-elapsed">{formatElapsed(elapsed)}</span>
        )}
      </div>

      {/* Step progress list */}
      {steps.length > 0 && (
        <div className="activity-steps">
          {steps.map((s, i) => {
            const isDone = s.status === "complete" || s.status === "approved"
            const isRunning = s.status === "running" || s.status === "retrying" || s.status === "revising"

            return (
              <div key={i} className={`activity-step ${s.status}`}>
                <span className="step-icon">
                  {isRunning ? "\u25c9" : isDone ? "\u2713" : "\u25cb"}
                </span>
                <span className="step-name">{formatStepLabel(s)}</span>
                {s.wordCount !== undefined && <span className="step-detail">{s.wordCount}w</span>}
                {s.issueCount !== undefined && <span className="step-detail">{s.issueCount} issues</span>}
              </div>
            )
          })}
        </div>
      )}

      {/* Summary bar */}
      {steps.length > 1 && (
        <div className="activity-summary">
          {completedSteps.length}/{steps.length} steps complete
          {runningSteps.length > 0 && ` \u00b7 ${runningSteps.length} running`}
        </div>
      )}
    </div>
  )
}

function formatStepLabel(s: StepState): string {
  let label = STEP_LABELS[s.step] ?? s.step
  if (s.chapter) label += ` ${s.chapter}`
  if (s.attempt && s.attempt > 1) label += ` (attempt ${s.attempt})`
  if (s.status === "retrying") label = label + " \u2014 regenerating"
  if (s.status === "revising") label = label + " \u2014 revising"
  return label
}

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return m > 0 ? `${m}m ${s}s` : `${s}s`
}
