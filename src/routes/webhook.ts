import { Router, type RequestHandler } from "express";
import crypto from "node:crypto";
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

export const SIGNATURE_HEADER = "x-signature";

export function computeSignature(rawBody: Buffer, secret: string): Buffer {
  return crypto.createHmac("sha256", secret).update(rawBody).digest();
}

/** Rejects any request whose X-Signature header doesn't match HMAC-SHA256(rawBody, WEBHOOK_SECRET). */
export const verifySignature: RequestHandler = (req, res, next) => {
  const secret = process.env.WEBHOOK_SECRET;
  if (!secret) {
    console.error("WEBHOOK_SECRET is not set - refusing all webhook requests");
    return res.status(401).json({ error: "Unauthorized" });
  }

  const header = req.header(SIGNATURE_HEADER);
  if (!header) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const provided = Buffer.from(header, "hex");
  const expected = computeSignature(req.rawBody ?? Buffer.alloc(0), secret);

  // Malformed hex, or a length mismatch, means it can never match - and
  // timingSafeEqual throws rather than returning false on a length mismatch.
  if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  next();
};

export const webhookRouter = Router();

webhookRouter.post("/incident", verifySignature, async (req, res) => {
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
