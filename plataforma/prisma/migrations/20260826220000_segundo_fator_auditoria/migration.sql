-- Auditoria do segundo fator.
--
-- Ver o QR equivale a clonar o autenticador; trocá-lo transfere o acesso a
-- todos os prontuários para outro aparelho. As duas ações precisam de rastro,
-- e a própria médica as vê na tela de segurança.
ALTER TYPE "AcaoAuditoria" ADD VALUE 'VISUALIZOU_SEGUNDO_FATOR';
ALTER TYPE "AcaoAuditoria" ADD VALUE 'TROCOU_SEGUNDO_FATOR';
