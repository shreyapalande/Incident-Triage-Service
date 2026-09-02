import { Router } from "express";
import { prisma } from "../db.js";

export const incidentsRouter = Router();

incidentsRouter.get("/", async (req, res) => {
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  const incidents = await prisma.incident.findMany({
    where: status ? { status } : undefined,
    orderBy: { createdAt: "desc" },
  });
  res.json(incidents);
});

incidentsRouter.get("/:id", async (req, res) => {
  const incident = await prisma.incident.findUnique({ where: { id: req.params.id } });
  if (!incident) return res.status(404).json({ error: "Incident not found" });
  res.json(incident);
});

incidentsRouter.patch("/:id/resolve", async (req, res) => {
  const incident = await prisma.incident.findUnique({ where: { id: req.params.id } });
  if (!incident) return res.status(404).json({ error: "Incident not found" });

  const updated = await prisma.incident.update({
    where: { id: req.params.id },
    data: { status: "RESOLVED", resolvedAt: new Date() },
  });
  res.json(updated);
});
