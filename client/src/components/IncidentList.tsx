import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import type { Incident } from "../types";
import { SeverityBadge } from "./SeverityBadge";

export function IncidentList() {
  const [incidents, setIncidents] = useState<Incident[] | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    api.listIncidents(statusFilter || undefined).then((data) => {
      if (!cancelled) setIncidents(data);
    });
    const interval = setInterval(() => {
      api.listIncidents(statusFilter || undefined).then((data) => {
        if (!cancelled) setIncidents(data);
      });
    }, 15000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [statusFilter]);

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <label>
          Status:{" "}
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">All</option>
            <option value="OPEN">Open</option>
            <option value="RESOLVED">Resolved</option>
          </select>
        </label>
      </div>

      {incidents === null && <p>Loading...</p>}
      {incidents?.length === 0 && <p>No incidents.</p>}

      <table width="100%" cellPadding={8} style={{ borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ textAlign: "left", borderBottom: "1px solid #ddd" }}>
            <th>Severity</th>
            <th>Title</th>
            <th>Source</th>
            <th>Status</th>
            <th>Created</th>
          </tr>
        </thead>
        <tbody>
          {incidents?.map((incident) => (
            <tr key={incident.id} style={{ borderBottom: "1px solid #eee" }}>
              <td>
                <SeverityBadge severity={incident.severity} />
              </td>
              <td>
                <Link to={`/incidents/${incident.id}`}>{incident.title}</Link>
              </td>
              <td>{incident.source}</td>
              <td>{incident.status}</td>
              <td>{new Date(incident.createdAt).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
