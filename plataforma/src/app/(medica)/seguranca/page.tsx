import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { GestaoSegundoFator } from "@/components/auth/GestaoSegundoFator";

export const metadata = { title: "Segurança" };
export const dynamic = "force-dynamic";

export default async function PaginaSeguranca() {
  const sessao = await auth();
  if (!sessao?.user || sessao.user.papel !== "MEDICA") redirect("/entrar");

  const [medica, trocas] = await Promise.all([
    prisma.usuario.findUniqueOrThrow({
      where: { id: sessao.user.id },
      select: { nome: true, email: true, totpSecret: true },
    }),
    // Histórico curto: se alguém trocou o segundo fator sem ela saber, é aqui
    // que aparece. Trilha que ninguém lê não protege ninguém.
    prisma.auditoria.findMany({
      where: {
        usuarioId: sessao.user.id,
        acao: { in: ["TROCOU_SEGUNDO_FATOR", "VISUALIZOU_SEGUNDO_FATOR"] },
      },
      orderBy: { criadoEm: "desc" },
      take: 5,
      select: { acao: true, criadoEm: true, ip: true },
    }),
  ]);

  return (
    <main className="mx-auto max-w-lg px-4 py-8">
      <header>
        <Link
          href="/agenda"
          className="text-sm text-teal-800 underline underline-offset-2"
        >
          ← Agenda
        </Link>
        <h1 className="mt-3 font-serif text-2xl text-slate-900">Segurança</h1>
        <p className="mt-1 text-sm text-slate-600">
          {medica.nome} — {medica.email}
        </p>
      </header>

      <div className="mt-6">
        {medica.totpSecret ? (
          <GestaoSegundoFator />
        ) : (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-6">
            <h2 className="font-serif text-lg text-red-950">
              Sem segundo fator
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-red-900">
              Esta conta acessa todos os prontuários e está protegida apenas por
              senha. Peça para rodarem <code>npm run medica:senha</code> no
              servidor para ativar o segundo fator.
            </p>
          </div>
        )}
      </div>

      {trocas.length > 0 && (
        <section className="mt-8">
          <h2 className="text-sm font-semibold text-slate-700">
            Atividade recente no segundo fator
          </h2>
          <ul className="mt-2 space-y-1.5">
            {trocas.map((t, i) => (
              <li
                key={i}
                className="flex flex-wrap items-baseline justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm"
              >
                <span
                  className={
                    t.acao === "TROCOU_SEGUNDO_FATOR"
                      ? "font-medium text-amber-900"
                      : "text-slate-700"
                  }
                >
                  {t.acao === "TROCOU_SEGUNDO_FATOR"
                    ? "Trocado por um novo"
                    : "Código visualizado"}
                </span>
                <span className="text-xs text-slate-500">
                  {t.criadoEm.toLocaleString("pt-BR", {
                    dateStyle: "short",
                    timeStyle: "short",
                    timeZone: "America/Campo_Grande",
                  })}
                  {t.ip && ` · ${t.ip}`}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs leading-relaxed text-slate-500">
            Não reconhece alguma dessas ações? Troque a senha e o segundo fator
            imediatamente.
          </p>
        </section>
      )}
    </main>
  );
}
