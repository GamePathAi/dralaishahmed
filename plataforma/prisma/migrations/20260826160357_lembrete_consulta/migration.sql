-- AlterTable
ALTER TABLE "consultas" ADD COLUMN     "lembreteEnviadoEm" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "consultas_lembreteEnviadoEm_inicioEm_idx" ON "consultas"("lembreteEnviadoEm", "inicioEm");
