import { GoogleGenAI, Type } from "@google/genai";
import type { Logger } from "pino";
import { KeyRotator, parseKeysFromEnv } from "../llm/keyRotation.js";
import { logger as baseLogger } from "../logger.js";
import { TriageSchema, type TriageResult } from "./schema.js";

const MODEL = "gemini-3.5-flash-lite";

const SYSTEM_PROMPT = `You are an SRE on-call triage assistant. You will be given a raw
incident alert (source, title, description, and possibly a raw JSON payload from a
monitoring tool). Classify its severity, category, and produce a concise structured
summary and a concrete recommended first action for the on-call engineer.

Severity: distinguish three different situations rather than treating all uncertain
reports the same way:

No real signal (alarming language with no concrete detail, empty or near-empty
reports, urgency expressed only through tone) -> LOW. Do not let tone or urgency
language override the absence of actual content.
Vague but plausible signal (general observations, a few user reports, no hard
metrics yet, but a believable real issue) -> MEDIUM. Note in the summary that more
information is needed.
Unknown or unbounded blast radius (an unreviewed or unauthorized action taken
directly against production, an unknown script or change with unconfirmed effects)
-> HIGH, even with no confirmed harm yet. Unknown scope in a production system is
itself the risk - do not wait for confirmed damage before escalating this category.

For all other cases, be decisive: use concrete metrics, confirmed error rates, or
known impact to determine severity directly.

Category: choose exactly one of the following, using these boundaries:
- infra: hardware, database, networking, or service availability issues
- performance: latency or throughput degradation, without a full outage
- security: unauthorized access, data exposure, or suspicious activity
- data: data pipeline, reporting, or analytics issues; incorrect, delayed, or
  missing data
- customer-impact: issues primarily observed through customer-facing symptoms or
  support signals, where the underlying technical cause is not yet known
- unknown: no identifiable technical content - the report contains no named system,
  component, metric, or symptom to categorize against. Use this rather than
  guessing when there is genuinely nothing to point to.

When a report could fit more than one category, prefer whichever category matches
the most specific known technical cause (a named system, component, metric, or data
problem) over customer-impact. Use customer-impact only when the report's own signal
is a customer- or support-observed symptom and no underlying technical cause has been
identified yet.

Tiebreaker for security vs. infra: an unreviewed or unauthorized action taken against
a system (e.g., a script run without approval) is infra if the concern is about
system state or availability, and security only if there is indication of malicious
intent or external compromise - an internal, well-intentioned mistake by an
authorized person is not automatically security just because it was unreviewed.`;

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    severity: { type: Type.STRING, enum: ["CRITICAL", "HIGH", "MEDIUM", "LOW"] },
    category: {
      type: Type.STRING,
      enum: ["infra", "performance", "security", "data", "customer-impact", "unknown"],
    },
    summary: {
      type: Type.STRING,
      description: "2-4 sentence structured summary of what happened and likely impact",
    },
    recommendedAction: {
      type: Type.STRING,
      description: "Concrete next step(s) the on-call engineer should take first",
    },
  },
  required: ["severity", "category", "summary", "recommendedAction"],
};

let rotator: KeyRotator | undefined;

function getRotator(): KeyRotator {
  if (!rotator) {
    const keys = parseKeysFromEnv(process.env.GEMINI_API_KEYS);
    if (keys.length === 0) {
      throw new Error("GEMINI_API_KEYS is not set (comma-separated list of API keys)");
    }
    rotator = new KeyRotator(keys);
  }
  return rotator;
}

// Cap retries at a handful of keys rather than cycling the whole pool - if the
// service itself is degraded, trying 12 keys one after another just stacks up
// latency without improving the odds. Paired with TIME_BUDGET_MS as a hard
// ceiling so a worst case can't silently take 60+ seconds.
const MAX_ATTEMPTS = 3;
const TIME_BUDGET_MS = 15_000;
// 503 is a whole-service capacity problem, not a per-key limit - rotating
// keys doesn't help the way it does for a 429, so pause briefly instead.
const SERVICE_UNAVAILABLE_RETRY_DELAY_MS = 1_500;

function getErrorStatus(err: unknown): number | undefined {
  return (
    (err as { status?: number; code?: number })?.status ??
    (err as { status?: number; code?: number })?.code
  );
}

function isRateLimitError(err: unknown): boolean {
  return getErrorStatus(err) === 429;
}

function isServiceUnavailableError(err: unknown): boolean {
  return getErrorStatus(err) === 503;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class TriageError extends Error {
  attempts: number;
  retryTimeMs: number;

  constructor(message: string, attempts: number, retryTimeMs: number) {
    super(message);
    this.name = "TriageError";
    this.attempts = attempts;
    this.retryTimeMs = retryTimeMs;
  }
}

export interface TriageOutcome {
  result: TriageResult;
  /** Total number of Gemini calls made (including any retries). */
  attempts: number;
  /** Total wall-clock time spent across all attempts, including any retry delays. */
  retryTimeMs: number;
}

export async function triageIncident(input: {
  source: string;
  title: string;
  description?: string;
  rawPayload: unknown;
  log?: Logger;
}): Promise<TriageOutcome> {
  const log = input.log ?? baseLogger;

  const userContent = [
    `Source: ${input.source}`,
    `Title: ${input.title}`,
    input.description ? `Description: ${input.description}` : null,
    `Raw payload:\n${JSON.stringify(input.rawPayload, null, 2)}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const pool = getRotator();
  const loopStart = Date.now();
  let lastError: unknown;
  let attemptsMade = 0;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const elapsedBeforeAttempt = Date.now() - loopStart;
    if (elapsedBeforeAttempt >= TIME_BUDGET_MS) {
      log.warn(
        { event: "gemini_retry_budget_exceeded", model: MODEL, attempts: attemptsMade, retryTimeMs: elapsedBeforeAttempt },
        "Triage retry time budget exceeded, giving up",
      );
      break;
    }

    const apiKey = pool.getKey();
    const client = new GoogleGenAI({ apiKey });
    attemptsMade++;

    // Bind this attempt's own HTTP call to whatever's left of the overall
    // budget - otherwise a single slow/hanging call can blow past
    // TIME_BUDGET_MS on its own, since the check above only runs between
    // attempts, not during one.
    const remainingBudgetMs = TIME_BUDGET_MS - (Date.now() - loopStart);

    const attemptStart = Date.now();
    try {
      const response = await client.models.generateContent({
        model: MODEL,
        contents: userContent,
        config: {
          systemInstruction: SYSTEM_PROMPT,
          responseMimeType: "application/json",
          responseSchema: RESPONSE_SCHEMA,
          httpOptions: { timeout: remainingBudgetMs },
        },
      });
      const latencyMs = Date.now() - attemptStart;

      pool.reportSuccess(apiKey);

      log.info(
        {
          event: "gemini_call_completed",
          model: MODEL,
          attempt,
          latencyMs,
          usage: response.usageMetadata
            ? {
                promptTokenCount: response.usageMetadata.promptTokenCount,
                candidatesTokenCount: response.usageMetadata.candidatesTokenCount,
                totalTokenCount: response.usageMetadata.totalTokenCount,
              }
            : undefined,
        },
        "Gemini call completed",
      );

      if (!response.text) {
        throw new Error("Triage model returned an empty response");
      }

      const result = TriageSchema.parse(JSON.parse(response.text));
      return { result, attempts: attemptsMade, retryTimeMs: Date.now() - loopStart };
    } catch (err) {
      const latencyMs = Date.now() - attemptStart;
      lastError = err;

      if (isRateLimitError(err)) {
        log.warn(
          { event: "gemini_call_rate_limited", model: MODEL, attempt, latencyMs },
          "Gemini call rate-limited, rotating to next key",
        );
        pool.reportRateLimited(apiKey);
        continue;
      }

      if (isServiceUnavailableError(err)) {
        const remainingBudgetMs = TIME_BUDGET_MS - (Date.now() - loopStart);
        log.warn(
          { event: "gemini_call_unavailable", model: MODEL, attempt, latencyMs },
          "Gemini reported service unavailable, retrying after a short delay",
        );
        if (remainingBudgetMs > 0) {
          await sleep(Math.min(SERVICE_UNAVAILABLE_RETRY_DELAY_MS, remainingBudgetMs));
        }
        continue;
      }

      const retryTimeMsSoFar = Date.now() - loopStart;
      log.error(
        {
          event: "gemini_call_failed",
          model: MODEL,
          attempt,
          latencyMs,
          attempts: attemptsMade,
          retryTimeMs: retryTimeMsSoFar,
          err: err instanceof Error ? err.message : String(err),
        },
        "Gemini call failed",
      );
      throw new TriageError(
        err instanceof Error ? err.message : String(err),
        attemptsMade,
        retryTimeMsSoFar,
      );
    }
  }

  const retryTimeMs = Date.now() - loopStart;
  const message = `Triage failed after ${attemptsMade} attempt(s) over ${retryTimeMs}ms: ${lastError instanceof Error ? lastError.message : String(lastError)}`;
  log.error(
    { event: "gemini_retries_exhausted", model: MODEL, attempts: attemptsMade, retryTimeMs },
    message,
  );
  throw new TriageError(message, attemptsMade, retryTimeMs);
}
