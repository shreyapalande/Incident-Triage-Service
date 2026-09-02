import { GoogleGenAI, Type } from "@google/genai";
import { KeyRotator, parseKeysFromEnv } from "../llm/keyRotation.js";
import { TriageSchema, type TriageResult } from "./schema.js";

const MODEL = "gemini-3.5-flash-lite";

const SYSTEM_PROMPT = `You are an SRE on-call triage assistant. You will be given a raw
incident alert (source, title, description, and possibly a raw JSON payload from a
monitoring tool). Classify its severity, category, and produce a concise structured
summary and a concrete recommended first action for the on-call engineer. Be decisive
even with incomplete information - pick the most likely severity rather than defaulting
to MEDIUM out of caution.`;

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    severity: { type: Type.STRING, enum: ["CRITICAL", "HIGH", "MEDIUM", "LOW"] },
    category: {
      type: Type.STRING,
      description: "Short category label, e.g. infra, security, data, customer-impact, performance",
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
