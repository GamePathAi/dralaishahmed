import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { FormularioEntrada } from "@/components/auth/FormularioEntrada";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Entrar",
  robots: { index: false, follow: false },
};

export default async function PaginaEntrar({
  searchParams,
}: {
  searchParams: Promise<{ destino?: string; erro?: string }>;
}) {
  const { destino, erro } = await searchParams;

  // Já autenticado: manda para onde faz sentido pelo papel.
  const sessao = await auth();
  if (sessao?.user) {
    redirect(
      destinoSeguro(destino) ??
        (sessao.user.papel === "MEDICA" ? "/agenda" : "/minhas-consultas"),
    );
  }

  return (
    <main className="grid min-h-dvh place-items-center bg-slate-100 px-4 py-10">
      <div className="w-full max-w-md">
        <header className="mb-6 text-center">
          <h1 className="font-serif text-2xl text-slate-900">
            Dra. Laís Caroline Hahmed
          </h1>
          <p className="mt-1 text-sm text-slate-500">CRM-MS 16563</p>
        </header>

        <FormularioEntrada destino={destinoSeguro(destino)} erro={erro} />

        <p className="mt-6 text-center text-xs leading-relaxed text-slate-500">
          Em urgência, não aguarde o acesso. Procure o serviço de saúde mais
          próximo ou ligue <strong>192</strong>.
        </p>
      </div>
    </main>
  );
}

/**
 * Só aceita caminho interno.
 *
 * Sem esta checagem, `?destino=https://site-falso/` faria a plataforma
 * redirecionar o paciente para fora logo após o login — open redirect, o
 * degrau clássico para phishing em cima de um domínio confiável.
 */
function destinoSeguro(destino?: string): string | undefined {
  if (!destino) return undefined;
  if (!destino.startsWith("/") || destino.startsWith("//")) return undefined;
  return destino;
}
