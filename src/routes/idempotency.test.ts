import { test } from "node:test";
import assert from "node:assert/strict";
import { getOrCreateIncident, type IncidentStore, type NewIncidentData } from "./idempotency.js";

/** In-memory stand-in for Prisma, enforcing the same uniqueness Postgres would. */
function createFakeStore() {
  const rows: Array<Record<string, unknown>> = [];
  let nextId = 1;

  const store: IncidentStore = {
    async findByIdempotencyKey(key) {
      return (rows.find((r) => r.idempotencyKey === key) as any) ?? null;
    },
    async create(data) {
      if (data.idempotencyKey && rows.some((r) => r.idempotencyKey === data.idempotencyKey)) {
        throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
      }
      const row = { id: `incident-${nextId++}`, status: "OPEN", ...data };
      rows.push(row);
      return row as any;
    },
  };

  return { store, rows };
}

const SAMPLE_DATA: NewIncidentData = {
  source: "datadog",
  title: "DB CPU at 95%",
  description: "Primary Postgres instance CPU sustained above 90%",
  rawPayload: { title: "DB CPU at 95%" },
};

test("no idempotency key: always creates a new row", async () => {
  const { store, rows } = createFakeStore();

  const first = await getOrCreateIncident(store, undefined, SAMPLE_DATA);
  const second = await getOrCreateIncident(store, undefined, SAMPLE_DATA);

  assert.equal(first.created, true);
  assert.equal(second.created, true);
  assert.notEqual(first.incident.id, second.incident.id);
  assert.equal(rows.length, 2);
});

test("new idempotency key: creates and stores the key", async () => {
  const { store, rows } = createFakeStore();

  const result = await getOrCreateIncident(store, "key-abc", SAMPLE_DATA);

  assert.equal(result.created, true);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].idempotencyKey, "key-abc");
});

test("same idempotency key sent twice: second request returns the first incident, no duplicate row created", async () => {
  const { store, rows } = createFakeStore();

  const first = await getOrCreateIncident(store, "key-same", SAMPLE_DATA);
  const second = await getOrCreateIncident(store, "key-same", SAMPLE_DATA);

  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(second.incident.id, first.incident.id);

  // The count check - not just comparing response bodies.
  assert.equal(rows.length, 1);
});

test("different idempotency keys create separate rows", async () => {
  const { store, rows } = createFakeStore();

  await getOrCreateIncident(store, "key-1", SAMPLE_DATA);
  await getOrCreateIncident(store, "key-2", SAMPLE_DATA);

  assert.equal(rows.length, 2);
});

test("a create that races another request for the same key falls back to the existing row", async () => {
  const { rows } = createFakeStore();
  // Simulate: by the time create() runs, another request already inserted
  // the row for this key (a race the findByIdempotencyKey check missed).
  const winner = { id: "incident-winner", idempotencyKey: "key-race", ...SAMPLE_DATA };

  let findCalls = 0;
  const racyStore: IncidentStore = {
    async findByIdempotencyKey(key) {
      findCalls++;
      // First check (before create): nothing yet. Second check (after the
      // race is detected): the winner is now visible.
      return findCalls === 1 ? null : (rows.find((r) => r.idempotencyKey === key) as any) ?? (winner as any);
    },
    async create() {
      throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
    },
  };

  const result = await getOrCreateIncident(racyStore, "key-race", SAMPLE_DATA);

  assert.equal(result.created, false);
  assert.equal(result.incident.id, "incident-winner");
});
