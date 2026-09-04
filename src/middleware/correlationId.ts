import crypto from "node:crypto";
import type { RequestHandler } from "express";
import { logger } from "../logger.js";

/**
 * Assigns a UUID to every incoming request and a child logger pre-bound with
 * it, so every log line produced while handling a request carries the same
 * correlationId and can be grepped/joined together.
 */
export const correlationId: RequestHandler = (req, _res, next) => {
  req.correlationId = crypto.randomUUID();
  req.log = logger.child({ correlationId: req.correlationId });
  next();
};
