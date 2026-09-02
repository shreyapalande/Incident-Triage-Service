import { BrowserRouter, Routes, Route } from "react-router-dom";
import { IncidentList } from "./components/IncidentList";
import { IncidentDetail } from "./components/IncidentDetail";

export default function App() {
  return (
    <BrowserRouter>
      <div style={{ maxWidth: 960, margin: "0 auto", padding: 24, fontFamily: "sans-serif" }}>
        <h1>Incident Dashboard</h1>
        <Routes>
          <Route path="/" element={<IncidentList />} />
          <Route path="/incidents/:id" element={<IncidentDetail />} />
        </Routes>
      </div>
    </BrowserRouter>
  );
}
