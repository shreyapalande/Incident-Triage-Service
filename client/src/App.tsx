import { BrowserRouter, Routes, Route, Link } from "react-router-dom";
import { IncidentList } from "./components/IncidentList";
import { IncidentDetail } from "./components/IncidentDetail";

export default function App() {
  return (
    <BrowserRouter>
      <div className="app-shell">
        <header className="app-header">
          <div className="app-header-inner">
            <div className="app-logo-mark">◆</div>
            <Link to="/" style={{ display: "flex", alignItems: "baseline", textDecoration: "none" }}>
              <span className="app-title">Incident Triage</span>
              <span className="app-subtitle">on-call dashboard</span>
            </Link>
          </div>
        </header>
        <main className="app-main">
          <Routes>
            <Route path="/" element={<IncidentList />} />
            <Route path="/incidents/:id" element={<IncidentDetail />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}
