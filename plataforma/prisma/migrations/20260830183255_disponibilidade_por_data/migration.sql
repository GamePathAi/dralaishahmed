-- CreateTable
CREATE TABLE "disponibilidades_data" (
    "id" TEXT NOT NULL,
    "medicaId" TEXT NOT NULL,
    "data" TIMESTAMP(3) NOT NULL,
    "inicioMin" INTEGER NOT NULL,
    "fimMin" INTEGER NOT NULL,
    "modalidade" "Modalidade" NOT NULL DEFAULT 'TELECONSULTA',
    "duracaoMin" INTEGER NOT NULL DEFAULT 30,
    "intervaloMin" INTEGER NOT NULL DEFAULT 10,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "disponibilidades_data_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "disponibilidades_data_medicaId_data_idx" ON "disponibilidades_data"("medicaId", "data");

-- AddForeignKey
ALTER TABLE "disponibilidades_data" ADD CONSTRAINT "disponibilidades_data_medicaId_fkey" FOREIGN KEY ("medicaId") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
