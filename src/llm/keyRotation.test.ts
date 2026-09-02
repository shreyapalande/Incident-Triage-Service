import { test } from "node:test";
import assert from "node:assert/strict";
import { KeyRotator, parseKeysFromEnv } from "./keyRotation.js";

test("rejects an empty key pool", () => {
  assert.throws(() => new KeyRotator([]));
});

test("round-robins across keys in order", () => {
  const rotator = new KeyRotator(["a", "b", "c"]);
  assert.deepEqual(
    [rotator.getKey(), rotator.getKey(), rotator.getKey(), rotator.getKey()],
    ["a", "b", "c", "a"],
  );
});

test("skips a rate-limited key until its cooldown elapses", () => {
  let now = 0;
  const rotator = new KeyRotator(["a", "b"], { cooldownMs: 1000, now: () => now });

  assert.equal(rotator.getKey(), "a");
  rotator.reportRateLimited("a");

  // "a" is benched - next call should land on "b" twice before "a" reappears.
  assert.equal(rotator.getKey(), "b");
  assert.equal(rotator.getKey(), "b");

  now = 1001; // cooldown elapsed
  assert.equal(rotator.getKey(), "a");
});

test("falls back to the soonest-to-recover key when every key is benched", () => {
  let now = 0;
  const rotator = new KeyRotator(["a", "b"], { cooldownMs: 1000, now: () => now });

  rotator.reportRateLimited("a"); // frees at 1000
  now = 500;
  rotator.reportRateLimited("b"); // frees at 1500

  assert.equal(rotator.isExhausted(), true);
  assert.equal(rotator.getKey(), "a");
});

test("reportSuccess clears a key's cooldown", () => {
  let now = 0;
  const rotator = new KeyRotator(["a"], { cooldownMs: 1000, now: () => now });

  rotator.reportRateLimited("a");
  assert.equal(rotator.isExhausted(), true);

  rotator.reportSuccess("a");
  assert.equal(rotator.isExhausted(), false);
});

test("parseKeysFromEnv trims and drops empty entries", () => {
  assert.deepEqual(parseKeysFromEnv(" key1 ,key2,, key3"), ["key1", "key2", "key3"]);
  assert.deepEqual(parseKeysFromEnv(undefined), []);
  assert.deepEqual(parseKeysFromEnv(""), []);
});
