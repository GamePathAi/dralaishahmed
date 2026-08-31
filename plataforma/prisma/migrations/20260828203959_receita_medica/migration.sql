-- CreateTable
CREATE TABLE "receitas" (
    "id" TEXT NOT NULL,
    "consultaId" TEXT NOT NULL,
    "pacienteId" TEXT NOT NULL,
    "medicaId" TEXT NOT NULL,
    "status" "StatusRegistro" NOT NULL DEFAULT 'RASCUNHO',
    "versao" INTEGER NOT NULL DEFAULT 1,
    "substituiId" TEXT,
    "itens" JSONB NOT NULL,
    "orientacoesGerais" TEXT,
    "temControlado" BOOLEAN NOT NULL DEFAULT false,
    "origemIA" BOOLEAN NOT NULL DEFAULT false,
    "modeloIA" TEXT,
    "rascunhoIA" JSONB,
    "editadaPelaMedica" BOOLEAN NOT NULL DEFAULT false,
    "assinadaEm" TIMESTAMP(3),
    "assinadaPor" TEXT,
    "assinaturaProvedor" TEXT,
    "assinaturaRef" TEXT,
    "documentoUrl" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "receitas_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "receitas_pacienteId_criadoEm_idx" ON "receitas"("pacienteId", "criadoEm");

-- CreateIndex
CREATE INDEX "receitas_consultaId_idx" ON "receitas"("consultaId");

-- AddForeignKey
ALTER TABLE "receitas" ADD CONSTRAINT "receitas_consultaId_fkey" FOREIGN KEY ("consultaId") REFERENCES "consultas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receitas" ADD CONSTRAINT "receitas_pacienteId_fkey" FOREIGN KEY ("pacienteId") REFERENCES "pacientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
