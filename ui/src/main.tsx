import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { BrowserRouter, Routes, Route } from "react-router-dom"
import { NovelList } from "./components/NovelList"
import { PipelineView } from "./components/PipelineView"
import "./styles/app.css"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter basename="/app">
      <Routes>
        <Route path="/" element={<NovelList />} />
        <Route path="/:novelId" element={<PipelineView />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
)
