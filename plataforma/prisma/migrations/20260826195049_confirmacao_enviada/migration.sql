-- AlterTable
ALTER TABLE "consultas" ADD COLUMN     "confirmacaoEnviadaEm" TIMESTAMP(3);

-- Backfill: consultas que já existiam foram agendadas antes de haver registro
-- de envio. Deixá-las nulas faria a agenda acusar "paciente não avisado" para
-- todas elas retroativamente — alarme falso no primeiro dia de uso.
UPDATE "consultas" SET "confirmacaoEnviadaEm" = "criadoEm" WHERE "confirmacaoEnviadaEm" IS NULL;
