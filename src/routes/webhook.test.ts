import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import type { Request, Response } from "express";
import { verifySignature, computeSignature, SIGNATURE_HEADER } from "./webhook.js";

const SECRET = "test-secret-value";
const OTHER_SECRET = "a-completely-different-secret";
const PAYLOAD = Buffer.from('{"source":"test","title":"disk full"}');
const OTHER_PAYLOAD = Buffer.from('{"source":"test","title":"totally different incident"}');

let originalSecret: string | undefined;

beforeEach(() => {
  originalSecret = process.env.WEBHOOK_SECRET;
  process.env.WEBHOOK_SECRET = SECRET;
});

afterEach(() => {
  process.env.WEBHOOK_SECRET = originalSecret;
});

interface Invocation {
  req: Request;
  res: Response;
  next: () => void;
  nextCalled: boolean;
  statusCode: number | undefined;
  body: unknown;
}

function invoke(rawBody: Buffer, signatureHeader: string | undefined): Invocation {
  const result: Invocation = {
    req: undefined as unknown as Request,
    res: undefined as unknown as Response,
    next: () => {
      result.nextCalled = true;
    },
    nextCalled: false,
    statusCode: undefined,
    body: undefined,
  };

  const req = {
    rawBody,
    header: (name: string) =>
      name.toLowerCase() === SIGNATURE_HEADER ? signatureHeader : undefined,
  } as unknown as Request;

  const res = {
    status(code: number) {
      result.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      result.body = payload;
      return this;
    },
  } as unknown as Response;

  result.req = req;
  result.res = res;

  verifySignature(req, res, result.next);
  return result;
}

function sign(rawBody: Buffer, secret: string): string {
  return computeSignature(rawBody, secret).toString("hex");
}

test("valid signature passes through to next()", () => {
  const result = invoke(PAYLOAD, sign(PAYLOAD, SECRET));
  assert.equal(result.nextCalled, true);
  assert.equal(result.statusCode, undefined);
});

test("missing header returns 401", () => {
  const result = invoke(PAYLOAD, undefined);
  assert.equal(result.nextCalled, false);
  assert.equal(result.statusCode, 401);
});

test("empty header returns 401", () => {
  const result = invoke(PAYLOAD, "");
  assert.equal(result.nextCalled, false);
  assert.equal(result.statusCode, 401);
});

test("malformed hex returns 401", () => {
  // "not-hex!!" contains characters outside [0-9a-f] - Buffer.from(..., "hex")
  // stops decoding at the first invalid character rather than throwing, which
  // yields a buffer of the wrong length and must be rejected, not crash.
  const result = invoke(PAYLOAD, "not-hex-at-all-zzzzzz");
  assert.equal(result.nextCalled, false);
  assert.equal(result.statusCode, 401);
});

test("correct-length-but-wrong signature returns 401", () => {
  const valid = sign(PAYLOAD, SECRET);
  // Flip one hex character, keeping the length identical (64 hex chars = 32 bytes).
  const flipped = (valid[0] === "0" ? "1" : "0") + valid.slice(1);
  assert.equal(flipped.length, valid.length);

  const result = invoke(PAYLOAD, flipped);
  assert.equal(result.nextCalled, false);
  assert.equal(result.statusCode, 401);
});

test("wrong-length hex is caught cleanly (no unhandled exception) and returns 401", () => {
  // Valid hex, but only 16 bytes instead of the 32 a real HMAC-SHA256 produces.
  // crypto.timingSafeEqual throws on mismatched buffer lengths, so the
  // middleware must guard against this rather than let it throw.
  const shortButValidHex = "00112233445566778899aabbccddeef";
  assert.doesNotThrow(() => {
    const result = invoke(PAYLOAD, shortButValidHex);
    assert.equal(result.nextCalled, false);
    assert.equal(result.statusCode, 401);
  });
});

test("signature computed with a different secret returns 401", () => {
  const result = invoke(PAYLOAD, sign(PAYLOAD, OTHER_SECRET));
  assert.equal(result.nextCalled, false);
  assert.equal(result.statusCode, 401);
});

test("tampering: valid signature for one payload used against a different payload returns 401", () => {
  const signatureForOriginalPayload = sign(PAYLOAD, SECRET);
  const result = invoke(OTHER_PAYLOAD, signatureForOriginalPayload);
  assert.equal(result.nextCalled, false);
  assert.equal(result.statusCode, 401);
});
