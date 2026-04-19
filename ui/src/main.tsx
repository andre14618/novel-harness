import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom"
import { Nav } from "./components/Nav"
import { PipelineView } from "./components/PipelineView"
import { GuidePage } from "./components/GuidePage"
import { FinetunePage } from "./components/FinetunePage"
import { ContextEngineeringPage } from "./components/ContextEngineeringPage"
import { DocsPage } from "./components/DocsPage"
import { ChartersPage } from "./components/ChartersPage"
import { NovelReadView } from "./components/NovelReadView"
import { StudioPage } from "./components/StudioPage"
import "./styles/app.css"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter basename="/app">
      <div className="app">
        <Nav />
        <Routes>
          <Route path="/" element={<Navigate to="/studio" replace />} />
          <Route path="/studio" element={<StudioPage />} />
          <Route path="/guide" element={<GuidePage />} />
          <Route path="/context" element={<ContextEngineeringPage />} />
          <Route path="/finetune" element={<FinetunePage />} />
          <Route path="/docs" element={<DocsPage />} />
          <Route path="/charters" element={<ChartersPage />} />
          <Route path="/todo" element={<Navigate to="/docs?doc=todo.md" replace />} />
          <Route path="/compare" element={<Navigate to="/guide" replace />} />
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
          <Route path="/context-engineering" element={<Navigate to="/context" replace />} />
          {/* Legacy redirects */}
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
