-- Job da Amazon Transcribe.
--
-- A transcrição passou de chamada síncrona (Whisper) para job assíncrono: a
-- linha nasce com `texto` vazio quando o job começa e é preenchida quando ele
-- termina. O índice único impede que dois jobs disputem a mesma transcrição.
ALTER TABLE "transcricoes" ADD COLUMN "jobNome" TEXT;

CREATE UNIQUE INDEX "transcricoes_jobNome_key" ON "transcricoes"("jobNome");
