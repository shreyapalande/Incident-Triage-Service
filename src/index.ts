import express from "express";
import cors from "cors";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { webhookRouter } from "./routes/webhook.js";
import { incidentsRouter } from "./routes/incidents.js";
import { triageEvalRouter } from "./routes/triageEval.js";
import "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(cors());
app.use(
  express.json({
    limit: "2mb",
    // Capture the exact raw bytes before JSON parsing so the webhook route
    // can verify an HMAC signature computed over what was actually sent -
    // the parsed/re-serialized body would not byte-for-byte match it.
    verify: (req, _res, buf) => {
      req.rawBody = Buffer.from(buf);
    },
  }),
);

app.use("/api/webhook", webhookRouter);
app.use("/api/incidents", incidentsRouter);
app.use("/api/triage-eval", triageEvalRouter);

app.get("/api/health", (_req, res) => res.json({ ok: true }));

if (process.env.NODE_ENV === "production") {
  const clientDist = path.join(__dirname, "..", "client", "dist");
  app.use(express.static(clientDist));
  app.get(/^(?!\/api).*/, (_req, res) => {
    res.sendFile(path.join(clientDist, "index.html"));
  });
}

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => {
  console.log(`Incident triage service listening on port ${port}`);
});
