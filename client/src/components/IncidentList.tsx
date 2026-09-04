import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import type { Incident } from "../types";
import { SeverityBadge } from "./SeverityBadge";
import { StatusBadge } from "./StatusBadge";
import { formatRelativeTime } from "../lib/time";

const FILTERS: { label: string; value: string }[] = [
  { label: "All", value: "" },
  { label: "Open", value: "OPEN" },
  { label: "Resolved", value: "RESOLVED" },
];

export function IncidentList() {
  const [incidents, setIncidents] = useState<Incident[] | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      api.listIncidents(statusFilter || undefined).then((data) => {
        if (!cancelled) setIncidents(data);
      });
    };
    load();
    const interval = setInterval(load, 15000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [statusFilter]);

  const openCount = incidents?.filter((i) => i.status === "OPEN").length;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Incidents</h1>
          <p className="page-description">
            {incidents === null
              ? "Loading incident history…"
              : openCount === undefined || openCount === 0
                ? "No open incidents right now."
                : `${openCount} open incident${openCount === 1 ? "" : "s"} need attention.`}
          </p>
        </div>
        <div className="filter-tabs">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              className={`filter-tab${statusFilter === f.value ? " active" : ""}`}
              onClick={() => setStatusFilter(f.value)}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="card" style={{ overflow: "hidden" }}>
        {incidents === null && (
          <div className="state-panel">
            <div className="spinner" />
            <div className="state-panel-title" style={{ marginTop: 8 }}>
              Loading incidents
            </div>
          </div>
        )}

        {incidents?.length === 0 && (
          <div className="state-panel">
            <div className="state-panel-icon">✓</div>
            <div className="state-panel-title">Nothing here</div>
            <div className="state-panel-hint">
              {statusFilter
                ? "No incidents match this filter."
                : "Incidents reported via the webhook will show up here."}
            </div>
          </div>
        )}

        {incidents !== null && incidents.length > 0 && (
          <table className="incident-table">
            <thead>
              <tr>
                <th>Severity</th>
                <th>Incident</th>
                <th>Source</th>
                <th>Status</th>
                <th style={{ textAlign: "right" }}>Reported</th>
              </tr>
            </thead>
            <tbody>
              {incidents.map((incident) => (
                <tr key={incident.id}>
                  <td>
                    <SeverityBadge severity={incident.severity} />
                  </td>
                  <td>
                    <Link className="incident-row-link" to={`/incidents/${incident.id}`}>
                      {incident.title}
                    </Link>
                  </td>
                  <td className="cell-muted">{incident.source}</td>
                  <td>
                    <StatusBadge status={incident.status} />
                  </td>
                  <td className="cell-timestamp" style={{ textAlign: "right" }}>
                    {formatRelativeTime(incident.createdAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
