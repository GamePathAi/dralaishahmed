/**
 * Perfil profissional — porta de entrada da plataforma.
 *
 * Deliberadamente enxuta: o conteúdo institucional (trajetória, áreas de
 * atendimento, política de privacidade) vive no site em dralaishahmed.com.br.
 * Duplicar aqui criaria dois textos para manter em sincronia — e é justamente
 * texto sujeito às regras do CFM sobre publicidade médica, onde divergência
 * entre versões é problema.
 *
 * Esta página tem uma função só: levar quem chegou para agendar ou entrar.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { env } from "@/lib/env";

export const metadata: Metadata = {
  title: "Dra. Laís Caroline Hahmed",
  description: "Agendamento e teleconsulta.",
};

export default function PaginaInicial() {
  return (
    <main className="grid min-h-dvh place-items-center px-4 py-12">
      <div className="w-full max-w-md text-center">
        <h1 className="font-serif text-3xl text-slate-900">{env.NOME_MEDICA}</h1>
        <p className="mt-2 text-sm text-slate-600">
          {env.CRM_MEDICA} · Telemedicina e Atenção Primária
        </p>

        <div className="mt-8 space-y-3">
          <Link
            href="/agendar"
            className="block w-full rounded-xl bg-teal-800 px-6 py-4 text-sm font-semibold text-white hover:bg-teal-900"
          >
            Marcar consulta
          </Link>
          <Link
            href="/entrar"
            className="block w-full rounded-xl border border-slate-300 px-6 py-4 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            Já sou paciente — acessar
          </Link>
        </div>

        <p className="mt-8 text-sm text-slate-500">
          Conheça a trajetória e as áreas de atendimento em{" "}
          <a
            href="https://www.dralaishahmed.com.br"
            className="text-teal-800 underline underline-offset-2"
          >
            dralaishahmed.com.br
          </a>
        </p>

        <p className="mt-6 border-t border-slate-200 pt-6 text-xs leading-relaxed text-slate-500">
          Esta plataforma não atende urgências. Em caso de emergência, procure o
          serviço de saúde mais próximo ou ligue <strong>192</strong>.
        </p>
      </div>
    </main>
  );
}
