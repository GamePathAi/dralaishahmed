-- Preferências de custo da médica: modelo da nota e modo do assistente.
-- Defaults preservam o comportamento atual (Opus, sempre oferecer).
ALTER TABLE "usuarios" ADD COLUMN "modeloNota" TEXT NOT NULL DEFAULT 'OPUS';
ALTER TABLE "usuarios" ADD COLUMN "modoAssistente" TEXT NOT NULL DEFAULT 'SEMPRE';
