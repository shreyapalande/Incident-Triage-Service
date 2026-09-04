import { z } from "zod";

export const TriageSchema = z.object({
  severity: z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW"]),
  category: z.enum(["infra", "performance", "security", "data", "customer-impact", "unknown"]),
  summary: z.string().describe(
    "2-4 sentence structured summary of what happened and likely impact, written for an on-call engineer",
  ),
  recommendedAction: z.string().describe(
    "Concrete next step(s) the on-call engineer should take first",
  ),
});

export type TriageResult = z.infer<typeof TriageSchema>;
