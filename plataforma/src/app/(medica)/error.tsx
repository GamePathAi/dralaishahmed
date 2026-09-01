"use client";

/**
 * Boundary de erro das telas da médica (registro, prontuário, atestado, exames…).
 *
 * Sem isto, um erro de render numa dessas páginas subia até o `global-error` e
 * a médica via uma tela quase em branco. Aqui a falha fica CONTIDA no conteúdo:
 * a barra de navegação continua, e ela tem "Tentar de novo" (re-render sem
 * recarregar tudo) e um caminho de volta. O erro é reportado ao Sentry.
 */

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

export default function ErroMedica({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <main className="mx-auto max-w-lg px-4 py-16 text-center">
      <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-full bg-amber-100 text-xl">
        ⚠️
      </div>
      <h1 className="font-serif text-xl text-slate-900">Esta tela teve um problema</h1>
      <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-slate-600">
        Um erro inesperado interrompeu esta página. Nada que já foi salvo no
        prontuário se perde. Tente de novo; se continuar, recarregue a página.
      </p>
      <div className="mt-6 flex flex-col items-center gap-2">
        <button
          type="button"
          onClick={() => reset()}
          className="rounded-xl bg-teal-800 px-6 py-3 text-sm font-semibold text-white hover:bg-teal-900"
        >
          Tentar de novo
        </button>
        <a
          href="/agenda"
          className="rounded-xl border border-slate-300 px-6 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          Voltar à agenda
        </a>
      </div>
    </main>
  );
}
