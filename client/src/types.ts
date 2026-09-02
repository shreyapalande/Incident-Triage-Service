export interface Incident {
  id: string;
  source: string;
  rawPayload: unknown;
  title: string;
  description: string | null;
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "UNKNOWN";
  category: string;
  summary: string;
  recommendedAction: string | null;
  status: "OPEN" | "RESOLVED";
  triageError: string | null;
  createdAt: string;
  resolvedAt: string | null;
}
