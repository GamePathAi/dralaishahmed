-- Separa consentimento de gravação na trilha de auditoria.
--
-- A rota de consentimento registrava `INICIOU_GRAVACAO`, o que fazia a trilha
-- afirmar que houve captura de áudio em consultas onde o gravador nunca chegou
-- a iniciar. Consentir é permitir, não é gravar.
--
-- As linhas antigas NÃO são reescritas: corrigir trilha de auditoria depois do
-- fato é pior do que conviver com um valor legado documentado.
ALTER TYPE "AcaoAuditoria" ADD VALUE 'REGISTROU_CONSENTIMENTO';
