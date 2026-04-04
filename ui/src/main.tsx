import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { BrowserRouter, Routes, Route } from "react-router-dom"
import { Nav } from "./components/Nav"
import { NovelList } from "./components/NovelList"
import { PipelineView } from "./components/PipelineView"
import { ConfigPage } from "./components/ConfigPage"
import { ExperimentsPage } from "./components/ExperimentsPage"
import { GuidePage } from "./components/GuidePage"
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
          <Route path="/guide" element={<GuidePage />} />
          <Route path="/:novelId" element={<PipelineView />} />
        </Routes>
      </div>
    </BrowserRouter>
  </StrictMode>,
)
