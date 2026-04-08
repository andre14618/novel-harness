import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom"
import { Nav } from "./components/Nav"
import { NovelList } from "./components/NovelList"
import { PipelineView } from "./components/PipelineView"
import { ConfigPage } from "./components/ConfigPage"
import { ExperimentsPage } from "./components/ExperimentsPage"
import { OperationsPage } from "./components/OperationsPage"
import { GuidePage } from "./components/GuidePage"
import { DocsPage } from "./components/DocsPage"
import { ModelsPage } from "./components/ModelsPage"
import { LoraComparePage } from "./components/LoraComparePage"
import { FinetunePage } from "./components/FinetunePage"
import { LLMCallsPage } from "./components/LLMCallsPage"
import "./styles/app.css"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter basename="/app">
      <div className="app">
        <Nav />
        <Routes>
          <Route path="/" element={<NovelList />} />
          <Route path="/config" element={<ConfigPage />} />
          <Route path="/experiments" element={<ExperimentsPage />} />
          <Route path="/operations" element={<OperationsPage />} />
          <Route path="/models" element={<ModelsPage />} />
          <Route path="/guide" element={<GuidePage />} />
          <Route path="/docs" element={<DocsPage />} />
          <Route path="/lora" element={<LoraComparePage />} />
          <Route path="/finetune" element={<FinetunePage />} />
          <Route path="/llm-calls" element={<LLMCallsPage />} />
          {/* Redirects for old routes */}
          <Route path="/context" element={<Navigate to="/config" replace />} />
          <Route path="/deterministic" element={<Navigate to="/config" replace />} />
          <Route path="/dashboard" element={<Navigate to="/operations" replace />} />
          <Route path="/:novelId" element={<PipelineView />} />
        </Routes>
      </div>
    </BrowserRouter>
  </StrictMode>,
)
