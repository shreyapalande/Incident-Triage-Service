-- CreateTable
CREATE TABLE "Incident" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "rawPayload" JSONB NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "severity" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "category" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "summary" TEXT NOT NULL DEFAULT '',
    "recommendedAction" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "triageError" TEXT,
    "slackMessageTs" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "Incident_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Incident_status_idx" ON "Incident"("status");

-- CreateIndex
CREATE INDEX "Incident_createdAt_idx" ON "Incident"("createdAt");
