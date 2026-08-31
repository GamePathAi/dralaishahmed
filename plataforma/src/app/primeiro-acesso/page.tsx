"use client";

/**
 * Pede o link de configuração inicial do acesso profissional.
 *
 * Página pública de propósito: quem precisa dela ainda não consegue logar.
 * A resposta do servidor é neutra (não confirma se o e-mail existe), então a
 * tela também não promete nada além de "confira a caixa de entrada".
 */

import { useState } from "react";

export default function PaginaPrimeiroAcesso() {
  const [enviando, setEnviando] = useState(false);
  const [enviado, setEnviado] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const pedir = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setEnviando(true);
    setErro(null);
    const email = String(new FormData(e.currentTarget).get("email") ?? "").trim();
    try {
      const r = await fetch("/api/medica/primeiro-acesso", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setErro(d.erro ?? "Não foi possível enviar. Tente novamente.");
        return;
      }
      setEnviado(email);
    } catch {
      setErro("Falha de conexão. Tente novamente.");
    } finally {
      setEnviando(false);
    }
  };

  if (enviado) {
    return (
      <main className="grid min-h-dvh place-items-center bg-slate-100 px-4">
        <div className="w-full max-w-md rounded-2xl bg-white p-8 text-center shadow-sm">
          <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-full bg-teal-50 text-xl">✉</div>
          <h1 className="font-serif text-xl text-slate-900">Confira o e-mail</h1>
          <p className="mx-auto mt-2 max-w-xs break-all text-sm font-medium text-slate-900">{enviado}</p>
          <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-slate-600">
            Se esse endereço corresponder a uma conta profissional ainda não
            configurada, chegará um link para definir a senha e cadastrar o
            aplicativo autenticador. Ele vale por 30 minutos.
          </p>
          <p className="mx-auto mt-3 max-w-xs text-xs text-slate-500">
            Não achou? Confira o lixo eletrônico.
          </p>
          <a href="/entrar" className="mt-5 inline-block text-sm text-teal-800 underline underline-offset-2">
            Voltar ao acesso
          </a>
        </div>
      </main>
    );
  }

  return (
    <main className="grid min-h-dvh place-items-center bg-slate-100 px-4">
      <form onSubmit={pedir} className="w-full max-w-md rounded-2xl bg-white p-8 shadow-sm">
        <h1 className="font-serif text-xl text-slate-900">Configurar primeiro acesso</h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-600">
          Para a conta profissional que ainda não tem senha nem aplicativo
          autenticador cadastrados. Você recebe um link por e-mail e faz toda a
          configuração pelo navegador.
        </p>

        <label className="mt-5 block">
          <span className="text-sm font-medium text-slate-700">E-mail da conta profissional</span>
          <input
            name="email"
            type="email"
            required
            autoFocus
            autoComplete="email"
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:border-teal-700 focus:ring-1 focus:ring-teal-700"
          />
        </label>

        {erro && <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{erro}</p>}

        <button
          type="submit"
          disabled={enviando}
          className="mt-5 w-full rounded-xl bg-teal-800 px-6 py-3 text-sm font-semibold text-white hover:bg-teal-900 disabled:opacity-50"
        >
          {enviando ? "Enviando…" : "Enviar link de configuração"}
        </button>

        <p className="mt-4 text-xs leading-relaxed text-slate-500">
          Conta já configurada e perdeu o acesso? Por segurança, a redefinição
          não acontece por e-mail — fale com quem administra o servidor.
        </p>

        <a href="/entrar" className="mt-4 block text-center text-sm text-slate-500 underline underline-offset-2 hover:text-slate-700">
          Voltar ao acesso
        </a>
      </form>
    </main>
  );
}
