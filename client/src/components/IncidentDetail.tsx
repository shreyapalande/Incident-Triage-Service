import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api";
import type { Incident } from "../types";
import { SeverityBadge } from "./SeverityBadge";
import { StatusBadge } from "./StatusBadge";
import { formatRelativeTime } from "../lib/time";

export function IncidentDetail() {
  const { id } = useParams<{ id: string }>();
  const [incident, setIncident] = useState<Incident | null>(null);
  const [resolving, setResolving] = useState(false);

  useEffect(() => {
    if (id) api.getIncident(id).then(setIncident);
  }, [id]);

  if (!incident) {
    return (
      <div className="state-panel">
        <div className="spinner" />
      </div>
    );
  }

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

  const isResolved = incident.status === "RESOLVED";

  return (
    <div>
      <Link className="back-link" to="/">
        ← All incidents
      </Link>

      <div className="detail-header">
        <div>
          <h1 className="detail-title">{incident.title}</h1>
          <div className="detail-meta-row">
            <SeverityBadge severity={incident.severity} />
            <StatusBadge status={incident.status} />
            <span className="badge-tag">{incident.category}</span>
            <span className="detail-meta-sep">·</span>
            <span className="cell-timestamp">
              {incident.source} · reported {formatRelativeTime(incident.createdAt)}
            </span>
          </div>
        </div>

        {isResolved ? (
          <button className="btn btn-success" disabled>
            ✓ Resolved
          </button>
        ) : (
          <button className="btn btn-primary" onClick={handleResolve} disabled={resolving}>
            {resolving ? <span className="spinner" style={{ borderTopColor: "white" }} /> : null}
            {resolving ? "Resolving…" : "Mark resolved"}
          </button>
        )}
      </div>

      {incident.triageError && (
        <div className="alert-banner">
          <span>⚠</span>
          <span>
            <strong>Triage failed.</strong> {incident.triageError}
          </span>
        </div>
      )}

      <div className="card detail-grid">
        <div className="detail-section">
          <p className="detail-section-title">Summary</p>
          <p className="detail-section-body">{incident.summary || "No summary available."}</p>
        </div>

        <div className="detail-section">
          <p className="detail-section-title">Recommended action</p>
          <p className="detail-section-body">
            {incident.recommendedAction || "No recommendation available."}
          </p>
        </div>
      </div>

      <details className="raw-payload">
        <summary>View raw payload</summary>
        <pre>{JSON.stringify(incident.rawPayload, null, 2)}</pre>
      </details>
    </div>
  );
}
