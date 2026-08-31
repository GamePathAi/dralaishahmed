import { redirect } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { GestaoBloqueios } from "@/components/agenda/GestaoBloqueios";
import { FUSO_MEDICA } from "@/lib/agenda";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Bloqueios de agenda",
  robots: { index: false, follow: false },
};

export default async function PaginaBloqueios() {
  const sessao = await auth();
  if (!sessao?.user || sessao.user.papel !== "MEDICA") {
    redirect("/entrar?destino=/agenda/bloqueios");
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <Link href="/agenda" className="text-sm text-slate-500 hover:text-slate-800">
        ← Voltar à agenda
      </Link>

      <header className="mt-4 mb-8">
        <h1 className="font-serif text-2xl text-slate-900">Bloqueios</h1>
        <p className="mt-2 max-w-prose text-sm leading-relaxed text-slate-600">
          Suspenda períodos específicos sem mexer na sua disponibilidade
          semanal. Férias, congresso, plantão, feriado — o bloqueio vence a
          recorrência e some da agenda pública enquanto durar.
        </p>
        <p className="mt-2 text-xs text-slate-500">
          Datas no fuso <strong>{FUSO_MEDICA.replace("_", " ")}</strong>.
        </p>
      </header>

      <GestaoBloqueios />

      <aside className="mt-10 rounded-xl border border-slate-200 bg-slate-50 p-4">
        <h2 className="text-sm font-semibold text-slate-800">
          Ausência definitiva num dia da semana
        </h2>
        <p className="mt-1.5 text-sm leading-relaxed text-slate-600">
          Se você deixou de atender às terças de vez, não crie bloqueios
          repetidos — remova a janela em{" "}
          <Link
            href="/agenda/disponibilidade"
            className="font-medium text-teal-800 underline underline-offset-2"
          >
            Disponibilidade
          </Link>
          . Bloqueio é para o que tem data para acabar.
        </p>
      </aside>
    </main>
  );
}
