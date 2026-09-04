import { Router } from "express";
import { z } from "zod";
import { triageIncident } from "../triage/triageIncident.js";

const TriageEvalRequestSchema = z
  .object({
    source: z.string().default("eval"),
    title: z.string().optional(),
    description: z.string().optional(),
  })
  .passthrough()
  .refine((data) => data.title || data.description, {
    message: "Request must include a title or description",
  });

export const triageEvalRouter = Router();

/**
 * Runs triage only - does not persist anything. Exists so the eval script can
 * call this repeatedly without writing rows into the real incidents table.
 */
triageEvalRouter.post("/", async (req, res) => {
  const parsed = TriageEvalRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.message });
  }

  const { source, title, description } = parsed.data;
  const incidentTitle = title ?? description!.slice(0, 120);

  try {
    const { result } = await triageIncident({
      source,
      title: incidentTitle,
      description,
      rawPayload: req.body,
    });
    return res.status(200).json(result);
  } catch (err) {
    return res.status(502).json({
      error: err instanceof Error ? err.message : "Unknown triage error",
    });
  }
});
