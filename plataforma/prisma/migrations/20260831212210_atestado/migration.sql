-- CreateEnum
CREATE TYPE "TipoAtestado" AS ENUM ('COMPARECIMENTO', 'AFASTAMENTO', 'REPOUSO');

-- CreateTable
CREATE TABLE "atestados" (
    "id" TEXT NOT NULL,
    "consultaId" TEXT NOT NULL,
    "pacienteId" TEXT NOT NULL,
    "medicaId" TEXT NOT NULL,
    "status" "StatusRegistro" NOT NULL DEFAULT 'RASCUNHO',
    "versao" INTEGER NOT NULL DEFAULT 1,
    "substituiId" TEXT,
    "tipo" "TipoAtestado" NOT NULL DEFAULT 'COMPARECIMENTO',
    "diasAfastamento" INTEGER,
    "cid" TEXT,
    "dataInicio" TIMESTAMP(3) NOT NULL,
    "textoLivre" TEXT NOT NULL,
    "origemIA" BOOLEAN NOT NULL DEFAULT false,
    "editadaPelaMedica" BOOLEAN NOT NULL DEFAULT false,
    "assinadaEm" TIMESTAMP(3),
    "assinadaPor" TEXT,
    "assinaturaProvedor" TEXT,
    "assinaturaRef" TEXT,
    "documentoUrl" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "atestados_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "atestados_pacienteId_criadoEm_idx" ON "atestados"("pacienteId", "criadoEm");

-- CreateIndex
CREATE INDEX "atestados_consultaId_idx" ON "atestados"("consultaId");

-- AddForeignKey
ALTER TABLE "atestados" ADD CONSTRAINT "atestados_consultaId_fkey" FOREIGN KEY ("consultaId") REFERENCES "consultas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "atestados" ADD CONSTRAINT "atestados_pacienteId_fkey" FOREIGN KEY ("pacienteId") REFERENCES "pacientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
