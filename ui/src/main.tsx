import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom"
import { Nav } from "./components/Nav"
import { PipelineView } from "./components/PipelineView"
import { ConfigPage } from "./components/ConfigPage"
import { ExperimentsPage } from "./components/ExperimentsPage"
import { GuidePage } from "./components/GuidePage"
import { DocsPage } from "./components/DocsPage"
import { ModelsPage } from "./components/ModelsPage"
import { LoraComparePage } from "./components/LoraComparePage"
import { LLMCallsPage } from "./components/LLMCallsPage"
import { CostsPage } from "./components/CostsPage"
import { NovelReadView } from "./components/NovelReadView"
import { StudioPage } from "./components/StudioPage"
import { DecisionsPage } from "./components/DecisionsPage"
import { AdaptersPage } from "./components/AdaptersPage"
import "./styles/app.css"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter basename="/app">
      <div className="app">
        <Nav />
        <Routes>
          <Route path="/" element={<Navigate to="/guide" replace />} />
          <Route path="/config" element={<ConfigPage />} />
          <Route path="/experiments" element={<ExperimentsPage />} />
          <Route path="/models" element={<ModelsPage />} />
          <Route path="/guide" element={<GuidePage />} />
          <Route path="/docs" element={<DocsPage />} />
          <Route path="/lora" element={<LoraComparePage />} />
          <Route path="/llm-calls" element={<LLMCallsPage />} />
          <Route path="/costs" element={<CostsPage />} />
          {/* Redirects for old routes */}
          <Route path="/context" element={<Navigate to="/config" replace />} />
          <Route path="/deterministic" element={<Navigate to="/config" replace />} />
          <Route path="/dashboard" element={<Navigate to="/guide" replace />} />
          <Route path="/operations" element={<Navigate to="/guide" replace />} />
          <Route path="/finetune" element={<Navigate to="/guide" replace />} />
          <Route path="/decisions" element={<DecisionsPage />} />
          <Route path="/adapters" element={<AdaptersPage />} />
          <Route path="/studio" element={<StudioPage />} />
          <Route path="/read" element={<NovelReadView />} />
          <Route path="/:novelId/read" element={<NovelReadView />} />
          <Route path="/:novelId" element={<PipelineView />} />
        </Routes>
      </div>
    </BrowserRouter>
  </StrictMode>,
)
