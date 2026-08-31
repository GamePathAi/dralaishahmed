"use client";

/**
 * O formulário que fecha o primeiro acesso: senha, QR e prova do código.
 *
 * A ordem dos passos na tela é a ordem real da tarefa — e o botão só salva
 * depois que o aplicativo PROVOU que gera o código certo. Configuração de
 * segundo fator que salva sem confirmar é conta trancada no primeiro login.
 */

import { useState } from "react";

interface Props {
  token: string;
  segredo: string;
  svg: string;
  email: string;
}

export function FormularioPrimeiroAcesso({ token, segredo, svg, email }: Props) {
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [concluido, setConcluido] = useState(false);

  const concluir = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setEnviando(true);
    setErro(null);
    const form = new FormData(e.currentTarget);
    const senha = String(form.get("senha") ?? "");
    const confirma = String(form.get("confirma") ?? "");

    if (senha !== confirma) {
      setErro("As senhas não conferem.");
      setEnviando(false);
      return;
    }

    try {
      const r = await fetch("/api/medica/primeiro-acesso/concluir", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          senha,
          segredo,
          codigo: String(form.get("codigo") ?? "").replace(/\s/g, ""),
        }),
      });
      const d = await r.json();
      if (!r.ok) {
        setErro(d.erro ?? "Não foi possível concluir.");
        return;
      }
      setConcluido(true);
    } catch {
      setErro("Falha de conexão. Tente novamente.");
    } finally {
      setEnviando(false);
    }
  };

  if (concluido) {
    return (
      <div className="w-full max-w-md rounded-2xl bg-white p-8 text-center shadow-sm">
        <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-full bg-teal-800 text-xl text-white">✓</div>
        <h1 className="font-serif text-xl text-slate-900">Acesso configurado</h1>
        <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-slate-600">
          Senha definida e aplicativo confirmado. A partir de agora, entre com o
          e-mail, a senha e o código do aplicativo.
        </p>
        <a
          href="/entrar"
          className="mt-6 inline-block rounded-xl bg-teal-800 px-6 py-3 text-sm font-semibold text-white hover:bg-teal-900"
        >
          Ir para o acesso
        </a>
      </div>
    );
  }

  return (
    <form onSubmit={concluir} className="w-full max-w-md rounded-2xl bg-white p-6 shadow-sm sm:p-8">
      <h1 className="font-serif text-xl text-slate-900">Configurar acesso profissional</h1>
      <p className="mt-1 break-all text-sm text-slate-500">{email}</p>

      {/* passo 1 — senha */}
      <fieldset className="mt-6">
        <legend className="text-sm font-semibold text-slate-800">1. Crie sua senha</legend>
        <label className="mt-3 block">
          <span className="text-sm font-medium text-slate-700">Senha (mínimo 12 caracteres)</span>
          <input name="senha" type="password" required minLength={12} autoComplete="new-password"
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:border-teal-700 focus:ring-1 focus:ring-teal-700" />
        </label>
        <label className="mt-3 block">
          <span className="text-sm font-medium text-slate-700">Repita a senha</span>
          <input name="confirma" type="password" required minLength={12} autoComplete="new-password"
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:border-teal-700 focus:ring-1 focus:ring-teal-700" />
        </label>
      </fieldset>

      {/* passo 2 — QR */}
      <fieldset className="mt-6">
        <legend className="text-sm font-semibold text-slate-800">2. Cadastre o aplicativo autenticador</legend>
        <p className="mt-1 text-sm leading-relaxed text-slate-600">
          Abra o Google Authenticator, Authy, Microsoft ou 1Password, toque em
          adicionar conta e escaneie:
        </p>
        <div
          className="mx-auto mt-3 w-fit rounded-xl border border-slate-200 bg-white p-3"
          dangerouslySetInnerHTML={{ __html: svg }}
        />
        <details className="mt-3">
          <summary className="cursor-pointer text-sm text-teal-800 underline underline-offset-2">
            A câmera não lê o código
          </summary>
          <div className="mt-2 rounded-lg bg-slate-50 px-4 py-3">
            <p className="text-sm text-slate-600">
              No aplicativo, escolha <em>inserir chave de configuração</em>, tipo{" "}
              <em>baseada em tempo</em>:
            </p>
            <p className="mt-2 select-all break-all font-mono text-sm font-semibold text-slate-900">{segredo}</p>
          </div>
        </details>
        <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900">
          Se o aplicativo já tiver entradas antigas com nome parecido, <strong>apague-as
          antes</strong> — códigos de entradas antigas são a causa nº 1 de
          “credenciais inválidas”.
        </p>
      </fieldset>

      {/* passo 3 — prova */}
      <fieldset className="mt-6">
        <legend className="text-sm font-semibold text-slate-800">3. Confirme o código</legend>
        <label className="mt-2 block">
          <span className="text-sm font-medium text-slate-700">Código de 6 dígitos que o aplicativo mostra agora</span>
          <input name="codigo" type="text" inputMode="numeric" pattern="\d{6}" maxLength={6} required
            autoComplete="one-time-code" placeholder="000000"
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 font-mono text-lg tracking-[0.3em] focus:border-teal-700 focus:ring-1 focus:ring-teal-700" />
        </label>
      </fieldset>

      {erro && <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{erro}</p>}

      <button type="submit" disabled={enviando}
        className="mt-6 w-full rounded-xl bg-teal-800 px-6 py-3 text-sm font-semibold text-white hover:bg-teal-900 disabled:opacity-50">
        {enviando ? "Confirmando…" : "Concluir configuração"}
      </button>

      <p className="mt-3 text-center text-xs text-slate-500">
        Nada é salvo até o código conferir — recarregar esta página gera um QR novo.
      </p>
    </form>
  );
}
