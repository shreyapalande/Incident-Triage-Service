import "node:http";

declare module "node:http" {
  interface IncomingMessage {
    /** Raw request body bytes, captured by express.json()'s verify callback in index.ts. Needed for HMAC signature verification, since the parsed body loses the exact bytes that were signed. */
    rawBody?: Buffer;
  }
}
