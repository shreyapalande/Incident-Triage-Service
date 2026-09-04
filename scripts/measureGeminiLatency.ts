/**
 * Standalone latency probe - NOT part of the app. Makes one direct call to
 * the Gemini API with the same SDK and a similarly-sized prompt to the real
 * triage call, and times it. No Express, no DB, no key rotation, no retries.
 *
 * Usage: npx tsx scripts/measureGeminiLatency.ts
 * Requires GEMINI_API_KEYS (or GEMINI_API_KEY) set in the environment - uses
 * only the first key, once.
 */
import { GoogleGenAI, Type } from "@google/genai";

const apiKey =
  process.env.GEMINI_API_KEY ?? (process.env.GEMINI_API_KEYS ?? "").split(",")[0]?.trim();

if (!apiKey) {
  console.error("Set GEMINI_API_KEY or GEMINI_API_KEYS in the environment first.");
  process.exit(1);
}

const MODEL = "gemini-3.5-flash-lite";

// Same prompt shape/size as the real triage call in src/triage/triageIncident.ts.
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

const USER_CONTENT = `Source: datadog

Title: DB CPU at 95%

Description: Primary Postgres instance CPU sustained above 90% for 10 minutes

Raw payload:
{
  "source": "datadog",
  "title": "DB CPU at 95%",
  "description": "Primary Postgres instance CPU sustained above 90% for 10 minutes"
}`;

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    severity: { type: Type.STRING, enum: ["CRITICAL", "HIGH", "MEDIUM", "LOW"] },
    category: {
      type: Type.STRING,
      enum: ["infra", "performance", "security", "data", "customer-impact", "unknown"],
    },
    summary: { type: Type.STRING },
    recommendedAction: { type: Type.STRING },
  },
  required: ["severity", "category", "summary", "recommendedAction"],
};

async function main() {
  const client = new GoogleGenAI({ apiKey });

  const start = Date.now();
  try {
    const response = await client.models.generateContent({
      model: MODEL,
      contents: USER_CONTENT,
      config: {
        systemInstruction: SYSTEM_PROMPT,
        responseMimeType: "application/json",
        responseSchema: RESPONSE_SCHEMA,
      },
    });
    const latencyMs = Date.now() - start;
    console.log(`latencyMs=${latencyMs} outcome=success`);
    console.log(response.text);
  } catch (err) {
    const latencyMs = Date.now() - start;
    console.log(`latencyMs=${latencyMs} outcome=error`);
    console.log(err instanceof Error ? err.message : String(err));
  }
}

main();
