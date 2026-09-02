import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api";
import type { Incident } from "../types";
import { SeverityBadge } from "./SeverityBadge";

export function IncidentDetail() {
  const { id } = useParams<{ id: string }>();
  const [incident, setIncident] = useState<Incident | null>(null);
  const [resolving, setResolving] = useState(false);

  useEffect(() => {
    if (id) api.getIncident(id).then(setIncident);
  }, [id]);

  if (!incident) return <p>Loading...</p>;

  async function handleResolve() {
    if (!id) return;
    setResolving(true);
    try {
      const updated = await api.resolveIncident(id);
      setIncident(updated);
    } finally {
      setResolving(false);
    }
  }

  return (
    <div>
      <Link to="/">&larr; Back to all incidents</Link>
      <h2 style={{ marginTop: 12 }}>{incident.title}</h2>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 16 }}>
        <SeverityBadge severity={incident.severity} />
        <span>{incident.category}</span>
        <span>·</span>
        <span>{incident.status}</span>
      </div>

      {incident.triageError && (
        <p style={{ color: "#dc2626" }}>Triage failed: {incident.triageError}</p>
      )}

      <section style={{ marginBottom: 16 }}>
        <h3>Summary</h3>
        <p>{incident.summary || "—"}</p>
      </section>

      <section style={{ marginBottom: 16 }}>
        <h3>Recommended action</h3>
        <p>{incident.recommendedAction || "—"}</p>
      </section>

      <button onClick={handleResolve} disabled={incident.status === "RESOLVED" || resolving}>
        {incident.status === "RESOLVED" ? "Resolved" : resolving ? "Resolving..." : "Resolve"}
      </button>

      <details style={{ marginTop: 24 }}>
        <summary>Raw payload</summary>
        <pre style={{ whiteSpace: "pre-wrap", background: "#f5f5f5", padding: 12 }}>
          {JSON.stringify(incident.rawPayload, null, 2)}
        </pre>
      </details>
    </div>
  );
}
