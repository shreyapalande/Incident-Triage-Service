import { Router, type RequestHandler } from "express";
import crypto from "node:crypto";
import { z } from "zod";
import { prisma } from "../db.js";
import { triageIncident, TriageError } from "../triage/triageIncident.js";
import { postToSlack } from "../slack/postToSlack.js";
import { correlationId } from "../middleware/correlationId.js";
import { logger as baseLogger } from "../logger.js";
import { getOrCreateIncident, type IncidentStore } from "./idempotency.js";
import type { Prisma } from "@prisma/client";

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
  const log = req.log ?? baseLogger;
  const secret = process.env.WEBHOOK_SECRET;

  if (!secret) {
    log.error(
      { event: "signature_verification", result: "fail", reason: "webhook_secret_not_configured" },
      "WEBHOOK_SECRET is not set - refusing all webhook requests",
    );
    return res.status(401).json({ error: "Unauthorized" });
  }

  const header = req.header(SIGNATURE_HEADER);
  if (!header) {
    log.warn(
      { event: "signature_verification", result: "fail", reason: "missing_header" },
      "Signature verification failed",
    );
    return res.status(401).json({ error: "Unauthorized" });
  }

  const provided = Buffer.from(header, "hex");
  const expected = computeSignature(req.rawBody ?? Buffer.alloc(0), secret);

  // Malformed hex, or a length mismatch, means it can never match - and
  // timingSafeEqual throws rather than returning false on a length mismatch.
  if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) {
    log.warn(
      { event: "signature_verification", result: "fail", reason: "signature_mismatch" },
      "Signature verification failed",
    );
    return res.status(401).json({ error: "Unauthorized" });
  }

  log.info({ event: "signature_verification", result: "pass" }, "Signature verification passed");
  next();
};

const IDEMPOTENCY_KEY_HEADER = "idempotency-key";

const prismaIncidentStore: IncidentStore = {
  findByIdempotencyKey: (key) => prisma.incident.findUnique({ where: { idempotencyKey: key } }),
  create: (data) =>
    prisma.incident.create({ data: { ...data, rawPayload: data.rawPayload as Prisma.InputJsonValue } }),
};

export const webhookRouter = Router();

webhookRouter.post(
  "/incident",
  correlationId,
  (req, res, next) => {
    req.log!.info(
      { event: "webhook_received", method: req.method, path: req.originalUrl, contentLength: req.rawBody?.length },
      "Webhook received",
    );
    next();
  },
  verifySignature,
  async (req, res) => {
    const log = req.log!;

    const parsed = IncidentAlertSchema.safeParse(req.body);
    if (!parsed.success) {
      log.warn(
        { event: "validation_result", result: "fail", reason: parsed.error.message },
        "Webhook payload failed validation",
      );
      return res.status(400).json({ error: parsed.error.message });
    }
    log.info({ event: "validation_result", result: "pass" }, "Webhook payload validated");

    const { source, title, description } = parsed.data;
    const incidentTitle = title ?? description!.slice(0, 120);
    const idempotencyKey = req.header(IDEMPOTENCY_KEY_HEADER) || undefined;

    const { incident, created } = await getOrCreateIncident(prismaIncidentStore, idempotencyKey, {
      source,
      title: incidentTitle,
      description,
      rawPayload: req.body,
    });

    if (!created) {
      log.info(
        { event: "db_write_result", operation: "idempotent_replay", incidentId: incident.id, idempotencyKey },
        "Idempotency key matched an existing incident - returning it without creating a duplicate",
      );
      return res.status(200).json(incident);
    }

    log.info(
      { event: "db_write_result", operation: "create", incidentId: incident.id },
      "Incident persisted",
    );

    try {
      log.info(
        { event: "triage_call_started", incidentId: incident.id },
        "Triage call started",
      );
      const triageStart = Date.now();
      const { result: triage, attempts, retryTimeMs } = await triageIncident({
        source,
        title: incidentTitle,
        description,
        rawPayload: req.body,
        log,
      });
      const triageLatencyMs = Date.now() - triageStart;
      log.info(
        {
          event: "triage_call_completed",
          incidentId: incident.id,
          latencyMs: triageLatencyMs,
          severity: triage.severity,
          category: triage.category,
          attempts,
          retryTimeMs,
        },
        "Triage call completed",
      );

      const updated = await prisma.incident.update({
        where: { id: incident.id },
        data: {
          severity: triage.severity,
          category: triage.category,
          summary: triage.summary,
          recommendedAction: triage.recommendedAction,
        },
      });
      log.info(
        { event: "db_write_result", operation: "update", incidentId: incident.id },
        "Incident updated with triage result",
      );

      log.info(
        { event: "slack_post_attempted", incidentId: incident.id },
        "Posting incident to Slack",
      );
      try {
        await postToSlack(updated, log);
        log.info(
          { event: "slack_post_result", incidentId: incident.id, result: "success" },
          "Slack post succeeded",
        );
      } catch (err) {
        log.error(
          {
            event: "slack_post_result",
            incidentId: incident.id,
            result: "failure",
            err: err instanceof Error ? err.message : String(err),
          },
          "Slack post failed",
        );
      }

      return res.status(201).json(updated);
    } catch (err) {
      log.error(
        {
          event: "triage_call_failed",
          incidentId: incident.id,
          err: err instanceof Error ? err.message : String(err),
          ...(err instanceof TriageError
            ? { attempts: err.attempts, retryTimeMs: err.retryTimeMs }
            : {}),
        },
        "Triage call failed",
      );
      const failed = await prisma.incident.update({
        where: { id: incident.id },
        data: { triageError: err instanceof Error ? err.message : "Unknown triage error" },
      });
      log.info(
        { event: "db_write_result", operation: "update", incidentId: incident.id },
        "Incident updated with triage error",
      );
      return res.status(201).json(failed);
    }
  },
);
