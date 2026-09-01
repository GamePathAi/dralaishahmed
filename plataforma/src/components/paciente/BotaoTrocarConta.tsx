"use client";

/**
 * "Sair e entrar com outro e-mail" — encerra a sessão atual e volta para o
 * login apontando de volta ao mesmo destino. Existe para o paciente que abriu
 * um link (sala, documento) já logado em OUTRA conta: a NavPaciente some nessas
 * telas, então o caminho para trocar de conta precisa vir na própria página.
 */

import { signOut } from "next-auth/react";

export function BotaoTrocarConta({ destino }: { destino: string }) {
  return (
    <button
      type="button"
      onClick={() =>
        signOut({ callbackUrl: `/entrar?destino=${encodeURIComponent(destino)}` })
      }
      className="rounded-xl bg-white px-6 py-3 text-sm font-semibold text-slate-900 hover:bg-slate-100"
    >
      Sair e entrar com outro e-mail
    </button>
  );
}
