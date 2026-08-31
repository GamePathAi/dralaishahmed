-- CreateEnum
CREATE TYPE "CategoriaDespesa" AS ENUM ('FERRAMENTAS', 'CONTADOR', 'IMPOSTOS', 'MARKETING', 'ALUGUEL', 'OUTROS');

-- AlterEnum
ALTER TYPE "MetodoPagamento" ADD VALUE 'DINHEIRO';

-- CreateTable
CREATE TABLE "despesas" (
    "id" TEXT NOT NULL,
    "medicaId" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "categoria" "CategoriaDespesa" NOT NULL DEFAULT 'OUTROS',
    "valorCent" INTEGER NOT NULL,
    "data" TIMESTAMP(3) NOT NULL,
    "recorrente" BOOLEAN NOT NULL DEFAULT false,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "despesas_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "despesas_medicaId_data_idx" ON "despesas"("medicaId", "data");

-- AddForeignKey
ALTER TABLE "despesas" ADD CONSTRAINT "despesas_medicaId_fkey" FOREIGN KEY ("medicaId") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
