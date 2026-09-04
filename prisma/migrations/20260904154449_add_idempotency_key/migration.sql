-- AlterTable
ALTER TABLE "Incident" ADD COLUMN "idempotencyKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Incident_idempotencyKey_key" ON "Incident"("idempotencyKey");
