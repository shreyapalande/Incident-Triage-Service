import type { Incident } from "@prisma/client";

export interface NewIncidentData {
  source: string;
  title: string;
  description?: string;
  rawPayload: unknown;
}

/** The subset of Prisma's incident operations idempotency needs - lets this be unit tested against an in-memory fake instead of a real DB. */
export interface IncidentStore {
  findByIdempotencyKey(key: string): Promise<Incident | null>;
  create(data: NewIncidentData & { idempotencyKey?: string }): Promise<Incident>;
}

function isUniqueConstraintViolation(err: unknown): boolean {
  return (err as { code?: string } | null)?.code === "P2002";
}

/**
 * Looks up an existing incident by idempotency key before creating a new one.
 * If the key is absent, always creates (today's behavior, unchanged). If a
 * create races another request for the same key, the unique constraint
 * catches it and this falls back to returning whichever row won.
 */
export async function getOrCreateIncident(
  store: IncidentStore,
  idempotencyKey: string | undefined,
  data: NewIncidentData,
): Promise<{ incident: Incident; created: boolean }> {
  if (idempotencyKey) {
    const existing = await store.findByIdempotencyKey(idempotencyKey);
    if (existing) {
      return { incident: existing, created: false };
    }
  }

  try {
    const incident = await store.create({ ...data, idempotencyKey });
    return { incident, created: true };
  } catch (err) {
    if (idempotencyKey && isUniqueConstraintViolation(err)) {
      const existing = await store.findByIdempotencyKey(idempotencyKey);
      if (existing) {
        return { incident: existing, created: false };
      }
    }
    throw err;
  }
}
