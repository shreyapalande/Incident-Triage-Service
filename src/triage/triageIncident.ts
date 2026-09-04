import { GoogleGenAI, Type } from "@google/genai";
import { KeyRotator, parseKeysFromEnv } from "../llm/keyRotation.js";
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

function isRateLimitError(err: unknown): boolean {
  const status = (err as { status?: number; code?: number })?.status ??
    (err as { status?: number; code?: number })?.code;
  return status === 429;
}

export async function triageIncident(input: {
  source: string;
  title: string;
  description?: string;
  rawPayload: unknown;
}): Promise<TriageResult> {
  const userContent = [
    `Source: ${input.source}`,
    `Title: ${input.title}`,
    input.description ? `Description: ${input.description}` : null,
    `Raw payload:\n${JSON.stringify(input.rawPayload, null, 2)}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const pool = getRotator();
  const attempts = Math.max(pool.size, 1);
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt++) {
    const apiKey = pool.getKey();
    const client = new GoogleGenAI({ apiKey });

    try {
      const response = await client.models.generateContent({
        model: MODEL,
        contents: userContent,
        config: {
          systemInstruction: SYSTEM_PROMPT,
          responseMimeType: "application/json",
          responseSchema: RESPONSE_SCHEMA,
        },
      });

      pool.reportSuccess(apiKey);

      if (!response.text) {
        throw new Error("Triage model returned an empty response");
      }

      return TriageSchema.parse(JSON.parse(response.text));
    } catch (err) {
      lastError = err;
      if (isRateLimitError(err)) {
        pool.reportRateLimited(apiKey);
        continue;
      }
      throw err;
    }
  }

  throw new Error(
    `Triage failed after exhausting the key pool: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
  );
}
