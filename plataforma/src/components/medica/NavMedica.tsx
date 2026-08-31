"use client";

/**
 * Navegação do painel da médica — a mesma barra em todas as telas dela, com a
 * página atual destacada e o "Sair". É montada uma vez no layout de `(medica)`,
 * então cada página não precisa repetir botões de navegação.
 *
 * Some sozinha na SALA de vídeo (`/atendimento/[id]`): durante a consulta a tela
 * deve ficar limpa. Reaparece na tela de registro pós-consulta e em todo o resto.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";

const LINKS = [
  { href: "/agenda", rotulo: "Agenda", dica: "Consultas do dia" },
  { href: "/pacientes", rotulo: "Pacientes", dica: "Prontuários" },
  { href: "/agenda/disponibilidade", rotulo: "Disponibilidade", dica: "Dias e horários que você atende" },
  { href: "/financeiro", rotulo: "Financeiro", dica: "Receitas, despesas e resultado do mês" },
  { href: "/configuracoes", rotulo: "Configurações", dica: "Assistente de IA e valores" },
  { href: "/seguranca", rotulo: "Segurança", dica: "Senha e segundo fator" },
];

export function NavMedica() {
  const pathname = usePathname() ?? "";

  // Sala de vídeo: `/atendimento/<id>` (sem mais segmentos). A tela de registro
  // `/atendimento/<id>/registro` MANTÉM a navegação.
  if (/^\/atendimento\/[^/]+$/.test(pathname)) return null;

  const ativo = (href: string) =>
    href === "/agenda" ? pathname === "/agenda" : pathname.startsWith(href);

  return (
    <header className="border-b border-slate-200 bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3">
        <Link href="/agenda" className="font-serif text-base text-slate-900">
          Dra. Laís <span className="text-slate-400">· painel</span>
        </Link>

        <nav className="flex flex-wrap items-center gap-1">
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              title={l.dica}
              aria-current={ativo(l.href) ? "page" : undefined}
              className={`rounded-lg px-3 py-1.5 text-sm transition ${
                ativo(l.href)
                  ? "bg-teal-50 font-medium text-teal-900"
                  : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              {l.rotulo}
            </Link>
          ))}
          <button
            type="button"
            onClick={() => signOut({ callbackUrl: "/entrar" })}
            title="Encerrar a sessão neste aparelho"
            className="ml-1 rounded-lg px-3 py-1.5 text-sm text-slate-500 hover:bg-red-50 hover:text-red-700"
          >
            Sair
          </button>
        </nav>
      </div>
    </header>
  );
}
