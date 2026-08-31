"use client";

/**
 * Cadastro do segundo fator num aparelho novo.
 *
 * O caso real que esta tela resolve: a médica trocou de celular e perdeu o
 * autenticador. Sem ela, a saída seria alguém rodar um script no servidor —
 * o que na prática significa ficar sem acesso ao próprio consultório até
 * conseguir suporte técnico.
 *
 * A senha é pedida de novo, mesmo com a sessão aberta. Ver o QR do aparelho
 * atual é equivalente a clonar o segundo fator; trocá-lo é decidir qual
 * aparelho passa a ter acesso a todos os prontuários.
 */

import { useState } from "react";

type Resultado = { svg: string; chave: string; trocado: boolean };

export function GestaoSegundoFator() {
  const [senha, setSenha] = useState("");
  const [codigo, setCodigo] = useState("");
  const [acao, setAcao] = useState<"ver" | "trocar">("ver");
  const [confirmandoTroca, setConfirmandoTroca] = useState(false);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [resultado, setResultado] = useState<Resultado | null>(null);

  const executar = async (qual: "ver" | "trocar") => {
    setCarregando(true);
    setErro(null);
    try {
      const r = await fetch("/api/medica/segundo-fator", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ senha, codigo: codigo.replace(/\s/g, ""), acao: qual }),
      });
      const dados = await r.json();
      if (!r.ok) {
        setErro(dados.erro ?? "Não foi possível continuar.");
        return;
      }
      setResultado(dados);
      setConfirmandoTroca(false);
      // Senha e código não ficam em memória depois de usados.
      setSenha("");
      setCodigo("");
    } catch {
      setErro("Falha de conexão. Tente novamente.");
    } finally {
      setCarregando(false);
    }
  };

  // ---- QR pronto ---------------------------------------------------------
  if (resultado) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-6 sm:p-8">
        <h2 className="font-serif text-lg text-slate-900">
          {resultado.trocado
            ? "Novo segundo fator gerado"
            : "Cadastre no autenticador"}
        </h2>

        {resultado.trocado && (
          <p className="mt-2 rounded-lg bg-amber-50 px-4 py-3 text-sm leading-relaxed text-amber-900">
            <strong>O aparelho anterior parou de funcionar agora.</strong> Escaneie
            o código abaixo antes de sair desta tela — ele não será mostrado de
            novo sem a senha.
          </p>
        )}

        <p className="mt-3 text-sm leading-relaxed text-slate-600">
          Abra o aplicativo autenticador, toque em adicionar conta e escaneie:
        </p>

        <div
          className="mx-auto mt-5 w-fit rounded-xl border border-slate-200 bg-white p-3"
          // SVG gerado no servidor a partir da própria URI — sem imagem externa
          // e sem mandar o segredo para nenhum serviço de QR de terceiro.
          dangerouslySetInnerHTML={{ __html: resultado.svg }}
        />

        <details className="mt-5">
          <summary className="cursor-pointer text-sm text-teal-800 underline underline-offset-2">
            A câmera não lê o código
          </summary>
          <div className="mt-3 rounded-lg bg-slate-50 px-4 py-3">
            <p className="text-sm text-slate-600">
              No aplicativo, escolha <em>inserir chave de configuração</em> e
              digite, marcando o tipo <em>baseada em tempo</em>:
            </p>
            <p className="mt-2 select-all break-all font-mono text-sm font-semibold text-slate-900">
              {resultado.chave}
            </p>
          </div>
        </details>

        <p className="mt-5 text-xs leading-relaxed text-slate-500">
          Confirme que o aplicativo já mostra um código de 6 dígitos antes de
          fechar esta página.
        </p>

        <button
          onClick={() => setResultado(null)}
          className="mt-5 w-full rounded-xl border border-slate-300 px-6 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          Concluído
        </button>
      </div>
    );
  }

  // ---- confirmação da troca ---------------------------------------------
  if (confirmandoTroca) {
    return (
      <div className="rounded-2xl border border-amber-300 bg-amber-50 p-6 sm:p-8">
        <h2 className="font-serif text-lg text-amber-950">
          Trocar o aparelho do segundo fator?
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-amber-900">
          Isso gera um código novo e <strong>invalida o aparelho atual
          imediatamente</strong>. Se você ainda tem acesso ao autenticador
          antigo e só quer vê-lo em outro aparelho, use{" "}
          <em>Ver o código atual</em> — que mantém os dois funcionando.
        </p>

        <div className="mt-6 flex flex-wrap gap-2">
          <button
            onClick={() => void executar("trocar")}
            disabled={carregando}
            className="rounded-xl bg-amber-700 px-6 py-3 text-sm font-semibold text-white hover:bg-amber-800 disabled:opacity-50"
          >
            {carregando ? "Gerando…" : "Sim, trocar"}
          </button>
          <button
            onClick={() => setConfirmandoTroca(false)}
            className="rounded-xl border border-amber-300 px-6 py-3 text-sm font-semibold text-amber-900 hover:bg-amber-100"
          >
            Cancelar
          </button>
        </div>
      </div>
    );
  }

  // ---- senha -------------------------------------------------------------
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (acao === "trocar") setConfirmandoTroca(true);
        else void executar("ver");
      }}
      className="rounded-2xl border border-slate-200 bg-white p-6 sm:p-8"
    >
      <h2 className="font-serif text-lg text-slate-900">Segundo fator</h2>
      <p className="mt-1 text-sm leading-relaxed text-slate-600">
        Confirme a senha <strong>e o código do aplicativo atual</strong> para
        continuar. Os dois são pedidos porque quem vê ou troca o segundo fator
        decide qual aparelho acessa os prontuários — só a senha não basta.
      </p>

      <label className="mt-5 block">
        <span className="text-sm font-medium text-slate-700">Senha</span>
        <input
          type="password"
          value={senha}
          onChange={(e) => setSenha(e.target.value)}
          required
          autoComplete="current-password"
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:border-teal-700 focus:ring-1 focus:ring-teal-700"
        />
      </label>

      <label className="mt-4 block">
        <span className="text-sm font-medium text-slate-700">
          Código do aplicativo (6 dígitos)
        </span>
        <input
          type="text"
          inputMode="numeric"
          pattern="\d{6}"
          maxLength={6}
          value={codigo}
          onChange={(e) => setCodigo(e.target.value)}
          required
          autoComplete="one-time-code"
          placeholder="000000"
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 font-mono text-lg tracking-[0.3em] focus:border-teal-700 focus:ring-1 focus:ring-teal-700"
        />
      </label>

      <fieldset className="mt-5">
        <legend className="text-sm font-medium text-slate-700">
          O que você precisa
        </legend>
        <div className="mt-2 space-y-2">
          <label className="flex items-start gap-3 rounded-lg border border-slate-200 p-3 hover:bg-slate-50">
            <input
              type="radio"
              name="acao"
              checked={acao === "ver"}
              onChange={() => setAcao("ver")}
              className="mt-0.5"
            />
            <span className="text-sm">
              <span className="font-medium text-slate-900">
                Ver o código atual
              </span>
              <span className="block text-slate-600">
                Cadastrar em mais um aparelho. O atual continua funcionando.
              </span>
            </span>
          </label>

          <label className="flex items-start gap-3 rounded-lg border border-slate-200 p-3 hover:bg-slate-50">
            <input
              type="radio"
              name="acao"
              checked={acao === "trocar"}
              onChange={() => setAcao("trocar")}
              className="mt-0.5"
            />
            <span className="text-sm">
              <span className="font-medium text-slate-900">
                Trocar por um novo
              </span>
              <span className="block text-slate-600">
                Perdeu o celular ou suspeita que alguém tem acesso. Invalida o
                aparelho antigo.
              </span>
            </span>
          </label>
        </div>
      </fieldset>

      {erro && (
        <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
          {erro}
        </p>
      )}

      <button
        type="submit"
        disabled={carregando || !senha || codigo.replace(/\s/g, "").length !== 6}
        className="mt-5 w-full rounded-xl bg-teal-800 px-6 py-3 text-sm font-semibold text-white hover:bg-teal-900 disabled:opacity-50"
      >
        {carregando ? "Verificando…" : "Continuar"}
      </button>
    </form>
  );
}
