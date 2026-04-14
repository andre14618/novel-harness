import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom"
import { Nav } from "./components/Nav"
import { PipelineView } from "./components/PipelineView"
import { GuidePage } from "./components/GuidePage"
import { DocsPage } from "./components/DocsPage"
import { FinetunePage } from "./components/FinetunePage"
import { NovelReadView } from "./components/NovelReadView"
import { StudioPage } from "./components/StudioPage"
import { ComparePage } from "./components/ComparePage"
import "./styles/app.css"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter basename="/app">
      <div className="app">
        <Nav />
        <Routes>
          <Route path="/" element={<Navigate to="/studio" replace />} />
          <Route path="/guide" element={<GuidePage />} />
          <Route path="/docs" element={<DocsPage />} />
          <Route path="/finetune" element={<FinetunePage />} />
          <Route path="/todo" element={<Navigate to="/docs?doc=todo.md" replace />} />
          <Route path="/studio" element={<StudioPage />} />
          <Route path="/compare" element={<ComparePage />} />
          <Route path="/read" element={<NovelReadView />} />
          <Route path="/:novelId/read" element={<NovelReadView />} />
          {/* Redirects for removed tabs — still accessible via direct URL */}
          <Route path="/config" element={<Navigate to="/guide" replace />} />
          <Route path="/experiments" element={<Navigate to="/guide" replace />} />
          <Route path="/models" element={<Navigate to="/guide" replace />} />
          <Route path="/llm-calls" element={<Navigate to="/guide" replace />} />
          <Route path="/costs" element={<Navigate to="/guide" replace />} />
          <Route path="/lora" element={<Navigate to="/finetune" replace />} />
          <Route path="/adapters" element={<Navigate to="/finetune" replace />} />
          <Route path="/decisions" element={<Navigate to="/docs?doc=decisions.md" replace />} />
          <Route path="/context-engineering" element={<Navigate to="/docs?doc=context-engineering.md" replace />} />
          {/* Legacy redirects */}
          <Route path="/context" element={<Navigate to="/guide" replace />} />
          <Route path="/deterministic" element={<Navigate to="/guide" replace />} />
          <Route path="/dashboard" element={<Navigate to="/guide" replace />} />
          <Route path="/operations" element={<Navigate to="/guide" replace />} />
          <Route path="/finetune-old" element={<Navigate to="/finetune" replace />} />
          <Route path="/:novelId" element={<PipelineView />} />
        </Routes>
      </div>
    </BrowserRouter>
  </StrictMode>,
)
