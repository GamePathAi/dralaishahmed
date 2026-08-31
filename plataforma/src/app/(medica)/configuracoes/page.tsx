import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { FormularioConfiguracoes } from "@/components/configuracoes/FormularioConfiguracoes";

export const metadata = { title: "Configurações" };
export const dynamic = "force-dynamic";

export default async function PaginaConfiguracoes() {
  const sessao = await auth();
  if (!sessao?.user || sessao.user.papel !== "MEDICA") redirect("/entrar");

  const m = await prisma.usuario.findUniqueOrThrow({
    where: { id: sessao.user.id },
    select: {
      modeloNota: true,
      modoAssistente: true,
      valorTeleconsultaCent: true,
      valorPresencialCent: true,
    },
  });

  return (
    <main className="mx-auto max-w-lg px-4 py-8">
      <header>
        <Link
          href="/agenda"
          className="text-sm text-teal-800 underline underline-offset-2"
        >
          ← Agenda
        </Link>
        <h1 className="mt-3 font-serif text-2xl text-slate-900">Configurações</h1>
        <p className="mt-1 text-sm text-slate-600">
          Ajustes do assistente de anotação e do custo por consulta.
        </p>
      </header>

      <div className="mt-6">
        <FormularioConfiguracoes inicial={m} />
      </div>
    </main>
  );
}
