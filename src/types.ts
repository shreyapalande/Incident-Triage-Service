import "node:http";
import type { Logger } from "pino";

declare module "node:http" {
  interface IncomingMessage {
    /** Raw request body bytes, captured by express.json()'s verify callback in index.ts. Needed for HMAC signature verification, since the parsed body loses the exact bytes that were signed. */
    rawBody?: Buffer;
    /** Per-request UUID, set by the correlation ID middleware in index.ts, so every log line for a request can be tied together. */
    correlationId?: string;
    /** Logger pre-bound with { correlationId }, set by the correlation ID middleware. Use this instead of the base logger inside request handlers. */
    log?: Logger;
  }
}
