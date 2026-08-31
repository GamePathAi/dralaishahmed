"use client";

/**
 * Barra de ações da tela de impressão. Some no papel (`@media print`), então
 * não aparece no PDF gerado — só o documento clínico é impresso.
 *
 * O "voltar" é um destino EXPLÍCITO (`voltarHref`), não `history.back()`. O
 * `javascript:history.back()` que existia aqui ficava morto sempre que a tela
 * de impressão era a primeira do histórico da aba (aberta em nova aba, por link
 * direto, ou depois que a janela de impressão do sistema mexe no foco) — o
 * clique não fazia nada. Voltar para a página que gerou a impressão é sempre
 * possível porque a URL dela é derivável do próprio id.
 */

import Link from "next/link";

export function BotaoImprimir({ voltarHref }: { voltarHref: string }) {
  return (
    <div className="no-print sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur">
      <Link href={voltarHref} className="text-sm text-slate-500 hover:text-slate-800">
        ← Voltar
      </Link>
      <div className="flex items-center gap-3">
        <span className="hidden text-xs text-slate-500 sm:inline">
          Na janela de impressão, escolha <strong>Salvar como PDF</strong> como destino.
        </span>
        <button
          onClick={() => window.print()}
          className="rounded-lg bg-teal-800 px-5 py-2 text-sm font-semibold text-white hover:bg-teal-900"
        >
          Imprimir / Salvar PDF
        </button>
      </div>
    </div>
  );
}
