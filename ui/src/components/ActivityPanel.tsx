import { useEffect, useState, useRef } from "react"
import type { SSEEvent } from "../api"

interface Props {
  events: SSEEvent[]
  active: boolean
}

interface StepState {
  step: string
  status: string
  startedAt: number
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

const STATUS_LABELS: Record<string, string> = {
  "running": "In progress",
  "complete": "Complete",
  "retrying": "Regenerating",
  "starting": "Starting",
  "approved": "Approved",
}

export function ActivityPanel({ events, active }: Props) {
  const [steps, setSteps] = useState<StepState[]>([])
  const [elapsed, setElapsed] = useState(0)
  const timerRef = useRef<ReturnType<typeof setInterval>>()

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
        startedAt: new Date(e.timestamp).getTime(),
        chapter: d.chapter as number | undefined,
        attempt: d.attempt as number | undefined,
        wordCount: d.wordCount as number | undefined,
        issueCount: d.issueCount as number | undefined,
      })
    }

    setSteps([...latestByStep.values()])
  }, [events])

  // Elapsed timer — ticks every second while active
  useEffect(() => {
    if (active) {
      timerRef.current = setInterval(() => setElapsed(e => e + 1), 1000)
    }
    return () => clearInterval(timerRef.current)
  }, [active])

  // Reset elapsed on new run
  useEffect(() => {
    if (active && events.length <= 1) setElapsed(0)
  }, [active, events.length])

  if (!active && steps.length === 0) return null

  const runningSteps = steps.filter(s => s.status === "running" || s.status === "retrying")
  const completedSteps = steps.filter(s => s.status === "complete" || s.status === "approved")
  const currentStep = runningSteps[runningSteps.length - 1]

  return (
    <div className="activity-panel">
      {/* Current activity header */}
      <div className="activity-header">
        {active ? (
          <>
            <div className="spinner" />
            <span className="activity-label">
              {currentStep
                ? formatStepLabel(currentStep)
                : "Processing..."}
            </span>
            <span className="activity-elapsed">{formatElapsed(elapsed)}</span>
          </>
        ) : (
          <span className="activity-label" style={{ color: "#4ecca3" }}>Pipeline idle</span>
        )}
      </div>

      {/* Step progress list */}
      {steps.length > 0 && (
        <div className="activity-steps">
          {steps.map((s, i) => (
            <div key={i} className={`activity-step ${s.status}`}>
              <span className="step-icon">
                {s.status === "running" || s.status === "retrying" ? "◉" :
                 s.status === "complete" || s.status === "approved" ? "✓" : "○"}
              </span>
              <span className="step-name">{formatStepLabel(s)}</span>
              {s.wordCount && <span className="step-detail">{s.wordCount}w</span>}
              {s.issueCount !== undefined && <span className="step-detail">{s.issueCount} issues</span>}
            </div>
          ))}
        </div>
      )}

      {/* Summary bar */}
      {steps.length > 1 && (
        <div className="activity-summary">
          {completedSteps.length}/{steps.length} steps complete
          {runningSteps.length > 0 && ` · ${runningSteps.length} running`}
        </div>
      )}
    </div>
  )
}

function formatStepLabel(s: StepState): string {
  let label = STEP_LABELS[s.step] ?? s.step
  if (s.chapter) label += ` ${s.chapter}`
  if (s.attempt && s.attempt > 1) label += ` (attempt ${s.attempt})`
  if (s.status === "retrying") label += " — regenerating"
  return label
}

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return m > 0 ? `${m}m ${s}s` : `${s}s`
}
