/**
 * POST /api/documentos/[tipo]/[id]/enviar
 * A médica disponibiliza ao paciente, por e-mail, um documento clínico
 * (receita | atestado | exames) com o link para vê-lo na área do paciente.
 *
 * Espelha o "Enviar link" da agenda: médica-only, rate-limit contra clique
 * repetido, checagem de posse por `medicaId`. Só envia documento ASSINADO —
 * rascunho não é documento; versão retificada foi substituída. Registra
 * EXPORTOU_DADOS (dado clínico saiu para o paciente precisa de rastro).
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { notificarDocumento } from "@/lib/notificacoes";
import { consumir } from "@/lib/rate-limit";
import type { TipoDocumento } from "@/lib/email";

export const dynamic = "force-dynamic";

const TIPOS: TipoDocumento[] = ["receita", "atestado", "exames"];

/** Carrega o essencial do documento pelo tipo (mesma forma para os três). */
async function carregar(tipo: TipoDocumento, id: string) {
  const include = {
    paciente: { select: { usuario: { select: { nome: true, email: true } } } },
  } as const;
  if (tipo === "receita") return prisma.receita.findUnique({ where: { id }, include });
  if (tipo === "atestado") return prisma.atestado.findUnique({ where: { id }, include });
  return prisma.solicitacaoExame.findUnique({ where: { id }, include });
}

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ tipo: string; id: string }> },
) {
  const { tipo, id } = await params;

  const sessao = await auth();
  if (!sessao?.user || sessao.user.papel !== "MEDICA") {
    return NextResponse.json({ erro: "Não autorizado." }, { status: 401 });
  }
  if (!TIPOS.includes(tipo as TipoDocumento)) {
    return NextResponse.json({ erro: "Tipo de documento inválido." }, { status: 404 });
  }
  const tipoDoc = tipo as TipoDocumento;

  // Evita cliques repetidos virarem enxurrada de e-mail para o paciente.
  const trava = consumir(`enviar-documento:${id}`, 3, 5 * 60_000);
  if (!trava.ok) {
    return NextResponse.json(
      { erro: "Documento já enviado há pouco. Aguarde alguns minutos." },
      { status: 429 },
    );
  }

  const doc = await carregar(tipoDoc, id);
  if (!doc) {
    return NextResponse.json({ erro: "Documento não encontrado." }, { status: 404 });
  }
  if (doc.medicaId !== sessao.user.id) {
    return NextResponse.json({ erro: "Não autorizado." }, { status: 403 });
  }
  if (doc.status !== "ASSINADO") {
    return NextResponse.json(
      {
        erro:
          doc.status === "RASCUNHO"
            ? "Assine o documento antes de enviá-lo ao paciente."
            : "Esta versão foi substituída. Envie a versão vigente.",
        codigo: "NAO_ENVIAVEL",
      },
      { status: 409 },
    );
  }

  const resultado = await notificarDocumento({
    nome: doc.paciente.usuario.nome,
    email: doc.paciente.usuario.email,
    tipo: tipoDoc,
    documentoId: id,
  });

  if (!resultado.email && !resultado.whatsapp) {
    return NextResponse.json(
      { erro: "Não foi possível enviar agora. Tente de novo em instantes.", codigo: "FALHA_ENVIO" },
      { status: 502 },
    );
  }

  const enviadoEm = new Date();
  await prisma.auditoria.create({
    data: {
      usuarioId: sessao.user.id,
      acao: "EXPORTOU_DADOS",
      recursoId: id,
      detalhe: { tipo: tipoDoc, formato: "email-link", destino: "paciente" },
    },
  });

  return NextResponse.json({ enviadoEm: enviadoEm.toISOString(), canais: resultado });
}
