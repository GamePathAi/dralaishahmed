-- AlterTable
ALTER TABLE "usuarios" ADD COLUMN     "emailVerificadoEm" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "tokens_verificacao" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "tokens_verificacao_token_key" ON "tokens_verificacao"("token");

-- CreateIndex
CREATE UNIQUE INDEX "tokens_verificacao_identifier_token_key" ON "tokens_verificacao"("identifier", "token");
