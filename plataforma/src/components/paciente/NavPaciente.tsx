"use client";

/**
 * Barra do paciente: identidade da clínica e o "Sair". Antes o paciente não
 * tinha como encerrar a sessão pela tela — e, já logado, o `/entrar` o
 * redirecionava de volta, então ele ficava preso na própria conta.
 *
 * Some na SALA de vídeo (`/sala/[id]`): durante a consulta a tela fica limpa.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";

export function NavPaciente() {
  const pathname = usePathname() ?? "";
  if (pathname.startsWith("/sala")) return null;

  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-4 py-3">
        <Link href="/minhas-consultas" className="font-serif text-base text-slate-900">
          Dra. Laís Caroline Hahmed
        </Link>
        <button
          type="button"
          onClick={() => signOut({ callbackUrl: "/entrar" })}
          title="Encerrar a sessão neste aparelho"
          className="rounded-lg px-3 py-1.5 text-sm text-slate-500 hover:bg-red-50 hover:text-red-700"
        >
          Sair
        </button>
      </div>
    </header>
  );
}
