import { redirect } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { ConfiguracaoDisponibilidade } from "@/components/agenda/ConfiguracaoDisponibilidade";
import { FUSO_MEDICA } from "@/lib/agenda";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Disponibilidade",
  robots: { index: false, follow: false },
};

export default async function PaginaDisponibilidade() {
  const sessao = await auth();
  if (!sessao?.user || sessao.user.papel !== "MEDICA") {
    redirect("/entrar?destino=/agenda/disponibilidade");
  }

  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <Link href="/agenda" className="text-sm text-slate-500 hover:text-slate-800">
        ← Voltar à agenda
      </Link>

      <header className="mt-4 mb-8">
        <h1 className="font-serif text-2xl text-slate-900">Disponibilidade</h1>
        <p className="mt-2 max-w-prose text-sm leading-relaxed text-slate-600">
          Defina seu padrão de semana e ajuste dia a dia no calendário. A agenda
          pública oferece apenas horários que você abrir aqui — o que não estiver
          aqui não aparece para o paciente.
        </p>
        {/* Sem isto, "14:00" fica ambíguo: a médica atua em MS e SP, e o
            paciente pode estar em qualquer fuso do país. */}
        <p className="mt-2 text-xs text-slate-500">
          Horários no fuso <strong>{FUSO_MEDICA.replace("_", " ")}</strong>. O
          paciente vê convertido para o fuso dele automaticamente.
        </p>
      </header>

      <ConfiguracaoDisponibilidade />

      <aside className="mt-10 rounded-xl border border-slate-200 bg-slate-50 p-4">
        <h2 className="text-sm font-semibold text-slate-800">
          Férias, plantão ou congresso
        </h2>
        <p className="mt-1.5 text-sm leading-relaxed text-slate-600">
          Não remova as janelas para se ausentar — isso apagaria a configuração
          da semana inteira. Use um <strong>bloqueio</strong>, que suspende um
          período específico e vence a recorrência.
        </p>
        <Link
          href="/agenda/bloqueios"
          className="mt-3 inline-block text-sm font-medium text-teal-800 underline underline-offset-2"
        >
          Gerenciar bloqueios →
        </Link>
      </aside>
    </main>
  );
}
