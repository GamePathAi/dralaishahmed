-- CreateEnum
CREATE TYPE "StatusPagamento" AS ENUM ('ISENTO', 'PENDENTE', 'PAGO', 'EXPIRADO', 'FALHOU', 'REEMBOLSADO');

-- CreateEnum
CREATE TYPE "MetodoPagamento" AS ENUM ('PIX', 'CARTAO', 'BOLETO');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AcaoAuditoria" ADD VALUE 'REGISTROU_PAGAMENTO';
ALTER TYPE "AcaoAuditoria" ADD VALUE 'REEMBOLSOU_PAGAMENTO';

-- AlterEnum
ALTER TYPE "StatusConsulta" ADD VALUE 'AGUARDANDO_PAGAMENTO';

-- AlterTable
ALTER TABLE "consultas" ADD COLUMN     "statusPagamento" "StatusPagamento" NOT NULL DEFAULT 'PENDENTE';

-- AlterTable
ALTER TABLE "usuarios" ADD COLUMN     "valorPresencialCent" INTEGER NOT NULL DEFAULT 30000,
ADD COLUMN     "valorTeleconsultaCent" INTEGER NOT NULL DEFAULT 30000;

-- CreateTable
CREATE TABLE "pagamentos" (
    "id" TEXT NOT NULL,
    "consultaId" TEXT NOT NULL,
    "valorCent" INTEGER NOT NULL,
    "metodo" "MetodoPagamento" NOT NULL DEFAULT 'PIX',
    "provedor" TEXT NOT NULL,
    "provedorRef" TEXT,
    "status" "StatusPagamento" NOT NULL DEFAULT 'PENDENTE',
    "pixCopiaCola" TEXT,
    "expiraEm" TIMESTAMP(3),
    "pagoEm" TIMESTAMP(3),
    "bruto" JSONB,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pagamentos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "pagamentos_consultaId_key" ON "pagamentos"("consultaId");

-- CreateIndex
CREATE UNIQUE INDEX "pagamentos_provedorRef_key" ON "pagamentos"("provedorRef");

-- AddForeignKey
ALTER TABLE "pagamentos" ADD CONSTRAINT "pagamentos_consultaId_fkey" FOREIGN KEY ("consultaId") REFERENCES "consultas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
