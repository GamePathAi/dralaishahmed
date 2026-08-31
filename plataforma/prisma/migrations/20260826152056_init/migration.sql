-- CreateEnum
CREATE TYPE "Papel" AS ENUM ('PACIENTE', 'MEDICA');

-- CreateEnum
CREATE TYPE "Modalidade" AS ENUM ('TELECONSULTA', 'PRESENCIAL');

-- CreateEnum
CREATE TYPE "StatusConsulta" AS ENUM ('AGENDADA', 'CONFIRMADA', 'EM_ANDAMENTO', 'CONCLUIDA', 'CANCELADA', 'FALTOU');

-- CreateEnum
CREATE TYPE "StatusRegistro" AS ENUM ('RASCUNHO', 'ASSINADO', 'RETIFICADO');

-- CreateEnum
CREATE TYPE "AcaoAuditoria" AS ENUM ('VISUALIZOU_PRONTUARIO', 'CRIOU_RASCUNHO_IA', 'EDITOU_RASCUNHO', 'ASSINOU_REGISTRO', 'RETIFICOU_REGISTRO', 'INICIOU_GRAVACAO', 'ENTROU_NA_SALA', 'CANCELOU_POR_BLOQUEIO', 'EXPORTOU_DADOS');

-- CreateTable
CREATE TABLE "usuarios" (
    "id" TEXT NOT NULL,
    "papel" "Papel" NOT NULL DEFAULT 'PACIENTE',
    "nome" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "telefone" TEXT,
    "cpf" TEXT,
    "nascimento" TIMESTAMP(3),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "senhaHash" TEXT,
    "totpSecret" TEXT,

    CONSTRAINT "usuarios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pacientes" (
    "id" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "alergias" TEXT,
    "medicacoesUso" TEXT,
    "antecedentes" TEXT,

    CONSTRAINT "pacientes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consultas" (
    "id" TEXT NOT NULL,
    "pacienteId" TEXT NOT NULL,
    "medicaId" TEXT NOT NULL,
    "modalidade" "Modalidade" NOT NULL DEFAULT 'TELECONSULTA',
    "status" "StatusConsulta" NOT NULL DEFAULT 'AGENDADA',
    "inicioEm" TIMESTAMP(3) NOT NULL,
    "duracaoMin" INTEGER NOT NULL DEFAULT 30,
    "motivo" TEXT,
    "salaNome" TEXT,
    "salaUrl" TEXT,
    "salaExpiraEm" TIMESTAMP(3),
    "iniciadaEm" TIMESTAMP(3),
    "encerradaEm" TIMESTAMP(3),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "consultas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "disponibilidades" (
    "id" TEXT NOT NULL,
    "medicaId" TEXT NOT NULL,
    "diaSemana" INTEGER NOT NULL,
    "inicioMin" INTEGER NOT NULL,
    "fimMin" INTEGER NOT NULL,
    "modalidade" "Modalidade" NOT NULL DEFAULT 'TELECONSULTA',
    "duracaoMin" INTEGER NOT NULL DEFAULT 30,
    "intervaloMin" INTEGER NOT NULL DEFAULT 10,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "disponibilidades_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bloqueios" (
    "id" TEXT NOT NULL,
    "medicaId" TEXT NOT NULL,
    "inicioEm" TIMESTAMP(3) NOT NULL,
    "fimEm" TIMESTAMP(3) NOT NULL,
    "motivo" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bloqueios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consentimentos" (
    "id" TEXT NOT NULL,
    "consultaId" TEXT NOT NULL,
    "aceito" BOOLEAN NOT NULL,
    "textoApresentado" TEXT NOT NULL,
    "versaoTexto" TEXT NOT NULL,
    "registradoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip" TEXT,
    "userAgent" TEXT,

    CONSTRAINT "consentimentos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transcricoes" (
    "id" TEXT NOT NULL,
    "consultaId" TEXT NOT NULL,
    "texto" TEXT NOT NULL,
    "idioma" TEXT NOT NULL DEFAULT 'pt',
    "duracaoSeg" INTEGER,
    "modelo" TEXT NOT NULL,
    "audioRemovido" BOOLEAN NOT NULL DEFAULT false,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transcricoes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "registros_clinicos" (
    "id" TEXT NOT NULL,
    "consultaId" TEXT NOT NULL,
    "pacienteId" TEXT NOT NULL,
    "status" "StatusRegistro" NOT NULL DEFAULT 'RASCUNHO',
    "versao" INTEGER NOT NULL DEFAULT 1,
    "substituiId" TEXT,
    "queixaPrincipal" TEXT NOT NULL,
    "historiaMoleastiaAtual" TEXT NOT NULL,
    "antecedentes" TEXT NOT NULL,
    "hipotesesDiagnosticas" TEXT NOT NULL,
    "conduta" TEXT NOT NULL,
    "observacoes" TEXT,
    "origemIA" BOOLEAN NOT NULL DEFAULT false,
    "modeloIA" TEXT,
    "rascunhoIA" JSONB,
    "editadoPelaMedica" BOOLEAN NOT NULL DEFAULT false,
    "assinadoEm" TIMESTAMP(3),
    "assinadoPor" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "registros_clinicos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auditorias" (
    "id" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "acao" "AcaoAuditoria" NOT NULL,
    "recursoId" TEXT NOT NULL,
    "detalhe" JSONB,
    "ip" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auditorias_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "usuarios_email_key" ON "usuarios"("email");

-- CreateIndex
CREATE UNIQUE INDEX "usuarios_cpf_key" ON "usuarios"("cpf");

-- CreateIndex
CREATE UNIQUE INDEX "pacientes_usuarioId_key" ON "pacientes"("usuarioId");

-- CreateIndex
CREATE INDEX "consultas_medicaId_inicioEm_idx" ON "consultas"("medicaId", "inicioEm");

-- CreateIndex
CREATE INDEX "consultas_pacienteId_inicioEm_idx" ON "consultas"("pacienteId", "inicioEm");

-- CreateIndex
CREATE UNIQUE INDEX "consultas_medicaId_inicioEm_key" ON "consultas"("medicaId", "inicioEm");

-- CreateIndex
CREATE INDEX "disponibilidades_medicaId_diaSemana_idx" ON "disponibilidades"("medicaId", "diaSemana");

-- CreateIndex
CREATE INDEX "bloqueios_medicaId_inicioEm_idx" ON "bloqueios"("medicaId", "inicioEm");

-- CreateIndex
CREATE UNIQUE INDEX "consentimentos_consultaId_key" ON "consentimentos"("consultaId");

-- CreateIndex
CREATE UNIQUE INDEX "transcricoes_consultaId_key" ON "transcricoes"("consultaId");

-- CreateIndex
CREATE INDEX "registros_clinicos_pacienteId_criadoEm_idx" ON "registros_clinicos"("pacienteId", "criadoEm");

-- CreateIndex
CREATE INDEX "auditorias_recursoId_criadoEm_idx" ON "auditorias"("recursoId", "criadoEm");

-- CreateIndex
CREATE INDEX "auditorias_usuarioId_criadoEm_idx" ON "auditorias"("usuarioId", "criadoEm");

-- AddForeignKey
ALTER TABLE "pacientes" ADD CONSTRAINT "pacientes_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consultas" ADD CONSTRAINT "consultas_pacienteId_fkey" FOREIGN KEY ("pacienteId") REFERENCES "pacientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consultas" ADD CONSTRAINT "consultas_medicaId_fkey" FOREIGN KEY ("medicaId") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "disponibilidades" ADD CONSTRAINT "disponibilidades_medicaId_fkey" FOREIGN KEY ("medicaId") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bloqueios" ADD CONSTRAINT "bloqueios_medicaId_fkey" FOREIGN KEY ("medicaId") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consentimentos" ADD CONSTRAINT "consentimentos_consultaId_fkey" FOREIGN KEY ("consultaId") REFERENCES "consultas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transcricoes" ADD CONSTRAINT "transcricoes_consultaId_fkey" FOREIGN KEY ("consultaId") REFERENCES "consultas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registros_clinicos" ADD CONSTRAINT "registros_clinicos_consultaId_fkey" FOREIGN KEY ("consultaId") REFERENCES "consultas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registros_clinicos" ADD CONSTRAINT "registros_clinicos_pacienteId_fkey" FOREIGN KEY ("pacienteId") REFERENCES "pacientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auditorias" ADD CONSTRAINT "auditorias_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
