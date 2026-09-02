import type { Incident } from "./types";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    throw new Error(`Request to ${path} failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  listIncidents: (status?: string) =>
    request<Incident[]>(`/incidents${status ? `?status=${status}` : ""}`),
  getIncident: (id: string) => request<Incident>(`/incidents/${id}`),
  resolveIncident: (id: string) =>
    request<Incident>(`/incidents/${id}/resolve`, { method: "PATCH" }),
};
