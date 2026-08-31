-- Guarda a chave do áudio no S3 junto da transcrição.
--
-- Ela vinha apenas do navegador da médica, a cada chamada. Se ela fechasse a
-- aba durante o processamento, ninguém mais sabia o nome do arquivo — e o
-- áudio da consulta ficava no bucket indefinidamente. Com a chave persistida,
-- o cron consegue concluir o job e apagar o áudio depois.
ALTER TABLE "transcricoes" ADD COLUMN "audioKey" TEXT;
