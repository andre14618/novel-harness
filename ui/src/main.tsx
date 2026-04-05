import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { BrowserRouter, Routes, Route } from "react-router-dom"
import { Nav } from "./components/Nav"
import { NovelList } from "./components/NovelList"
import { PipelineView } from "./components/PipelineView"
import { ConfigPage } from "./components/ConfigPage"
import { ContextPage } from "./components/ContextPage"
import { ExperimentsPage } from "./components/ExperimentsPage"
import { DashboardPage } from "./components/DashboardPage"
import { OperationsPage } from "./components/OperationsPage"
import { GuidePage } from "./components/GuidePage"
import { ModelsPage } from "./components/ModelsPage"
import "./styles/app.css"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter basename="/app">
      <div className="app">
        <Nav />
        <Routes>
          <Route path="/" element={<NovelList />} />
          <Route path="/config" element={<ConfigPage />} />
          <Route path="/context" element={<ContextPage />} />
          <Route path="/experiments" element={<ExperimentsPage />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/operations" element={<OperationsPage />} />
          <Route path="/models" element={<ModelsPage />} />
          <Route path="/guide" element={<GuidePage />} />
          <Route path="/:novelId" element={<PipelineView />} />
        </Routes>
      </div>
    </BrowserRouter>
  </StrictMode>,
)
