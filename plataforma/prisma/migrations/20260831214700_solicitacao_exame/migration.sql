-- CreateEnum
CREATE TYPE "CategoriaExame" AS ENUM ('SANGUE', 'IMAGEM', 'OUTROS');

-- CreateTable
CREATE TABLE "solicitacoes_exame" (
    "id" TEXT NOT NULL,
    "consultaId" TEXT NOT NULL,
    "pacienteId" TEXT NOT NULL,
    "medicaId" TEXT NOT NULL,
    "status" "StatusRegistro" NOT NULL DEFAULT 'RASCUNHO',
    "versao" INTEGER NOT NULL DEFAULT 1,
    "substituiId" TEXT,
    "itens" JSONB NOT NULL,
    "indicacaoClinica" TEXT,
    "origemIA" BOOLEAN NOT NULL DEFAULT false,
    "editadaPelaMedica" BOOLEAN NOT NULL DEFAULT false,
    "assinadaEm" TIMESTAMP(3),
    "assinadaPor" TEXT,
    "assinaturaProvedor" TEXT,
    "assinaturaRef" TEXT,
    "documentoUrl" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "solicitacoes_exame_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "solicitacoes_exame_pacienteId_criadoEm_idx" ON "solicitacoes_exame"("pacienteId", "criadoEm");

-- CreateIndex
CREATE INDEX "solicitacoes_exame_consultaId_idx" ON "solicitacoes_exame"("consultaId");

-- AddForeignKey
ALTER TABLE "solicitacoes_exame" ADD CONSTRAINT "solicitacoes_exame_consultaId_fkey" FOREIGN KEY ("consultaId") REFERENCES "consultas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solicitacoes_exame" ADD CONSTRAINT "solicitacoes_exame_pacienteId_fkey" FOREIGN KEY ("pacienteId") REFERENCES "pacientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
