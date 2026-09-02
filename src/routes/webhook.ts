import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { triageIncident } from "../triage/triageIncident.js";
import { postToSlack } from "../slack/postToSlack.js";

const IncidentAlertSchema = z
  .object({
    source: z.string().default("unknown"),
    title: z.string().optional(),
    description: z.string().optional(),
  })
  .passthrough()
  .refine((data) => data.title || data.description, {
    message: "Alert must include a title or description",
  });

export const webhookRouter = Router();

webhookRouter.post("/incident", async (req, res) => {
  const parsed = IncidentAlertSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.message });
  }

  const { source, title, description } = parsed.data;
  const incidentTitle = title ?? description!.slice(0, 120);

  const incident = await prisma.incident.create({
    data: {
      source,
      title: incidentTitle,
      description,
      rawPayload: req.body,
    },
  });

  try {
    const triage = await triageIncident({
      source,
      title: incidentTitle,
      description,
      rawPayload: req.body,
    });

    const updated = await prisma.incident.update({
      where: { id: incident.id },
      data: {
        severity: triage.severity,
        category: triage.category,
        summary: triage.summary,
        recommendedAction: triage.recommendedAction,
      },
    });

    try {
      await postToSlack(updated);
    } catch (err) {
      console.error("Failed to post to Slack:", err);
    }

    return res.status(201).json(updated);
  } catch (err) {
    console.error("Triage failed:", err);
    const failed = await prisma.incident.update({
      where: { id: incident.id },
      data: { triageError: err instanceof Error ? err.message : "Unknown triage error" },
    });
    return res.status(201).json(failed);
  }
});
