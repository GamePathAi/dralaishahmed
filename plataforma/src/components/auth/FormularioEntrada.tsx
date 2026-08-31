"use client";

/**
 * Entrada na plataforma.
 *
 * A aba de paciente é a padrão, e o acesso profissional fica num link discreto.
 * Não é estética: o acesso da médica é único e ela sabe onde procurar, enquanto
 * o paciente é quem chega perdido. Colocar dois campos de senha na frente de
 * quem entra por link mágico só gera "esqueci minha senha" de senha que nunca
 * existiu.
 */

import { useState } from "react";
import { signIn } from "next-auth/react";

type Aba = "paciente" | "medica";

export function FormularioEntrada({
  destino,
  erro: erroInicial,
}: {
  destino?: string;
  erro?: string;
}) {
  const [aba, setAba] = useState<Aba>("paciente");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(
    erroInicial ? "Não foi possível entrar. Tente novamente." : null,
  );
  const [linkEnviado, setLinkEnviado] = useState(false);
  const [enviadoPara, setEnviadoPara] = useState<string | null>(null);

  // ---- paciente: magic link ---------------------------------------------
  const enviarLink = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setEnviando(true);
    setErro(null);

    const email = String(new FormData(e.currentTarget).get("email") ?? "");
    const r = await signIn("nodemailer", {
      email,
      redirect: false,
      callbackUrl: destino ?? "/minhas-consultas",
    });

    setEnviando(false);

    // Duas situações que pareciam uma só, e a diferença importa:
    //
    // • "AccessDenied" — o callback recusou (sem cadastro, ou é o acesso da
    //   médica). Aqui a resposta genérica é DELIBERADA: dizer "não há conta"
    //   revelaria se determinada pessoa é paciente daqui, que é informação de
    //   saúde por dedução.
    //
    // • Qualquer outro erro — SMTP fora do ar, adapter quebrado, banco
    //   inacessível. Isso é falha nossa, não privacidade de ninguém. Antes,
    //   a tela dizia "verifique seu e-mail" mesmo com o backend em chamas, e
    //   a pessoa ficava esperando um link que nunca foi gerado.
    if (r?.error && r.error !== "AccessDenied") {
      console.error("[entrar] falha ao enviar o link", r.error);
      setErro(
        "Não foi possível enviar o link agora. Tente novamente em instantes — " +
          "se persistir, fale com a secretaria pelo WhatsApp.",
      );
      return;
    }

    setEnviadoPara(email.trim());
    setLinkEnviado(true);
  };

  // ---- médica: senha + TOTP ---------------------------------------------
  const entrarComCredenciais = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setEnviando(true);
    setErro(null);

    const form = new FormData(e.currentTarget);
    const r = await signIn("medica", {
      email: form.get("email"),
      senha: form.get("senha"),
      totp: form.get("totp"),
      redirect: false,
      callbackUrl: destino ?? "/agenda",
    });

    setEnviando(false);

    if (r?.error) {
      // Não diz qual dos fatores falhou — isso confirmaria a senha para quem
      // está testando combinações.
      setErro("Credenciais inválidas.");
      return;
    }
    window.location.href = r?.url ?? destino ?? "/agenda";
  };

  if (linkEnviado) {
    return (
      <div className="rounded-2xl bg-white p-8 text-center shadow-sm">
        <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-full bg-teal-50 text-xl">
          ✉
        </div>
        <h2 className="font-serif text-lg text-slate-900">Verifique seu e-mail</h2>

        {/* Mostrar o endereço é o que permite a pessoa perceber sozinha o erro
            de digitação — de longe a causa mais comum de "não chegou". */}
        {enviadoPara && (
          <p className="mx-auto mt-2 max-w-xs break-all text-sm font-medium text-slate-900">
            {enviadoPara}
          </p>
        )}

        <p className="mx-auto mt-2 max-w-xs text-sm leading-relaxed text-slate-600">
          Se houver uma conta com esse endereço, você receberá um link de acesso.
          Ele vale por 15 minutos e só pode ser usado uma vez.
        </p>
        <p className="mx-auto mt-3 max-w-xs text-xs leading-relaxed text-slate-500">
          Não encontrou? Confira o lixo eletrônico antes de pedir outro.
        </p>

        <div className="mt-6 flex flex-col items-center gap-3">
          <button
            onClick={() => setLinkEnviado(false)}
            className="text-sm text-teal-800 underline underline-offset-2"
          >
            Usar outro e-mail
          </button>
          <a
            href="/"
            className="text-sm text-slate-500 underline underline-offset-2 hover:text-slate-700"
          >
            Voltar ao site
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl bg-white p-6 shadow-sm sm:p-8">
      {aba === "paciente" ? (
        <form onSubmit={enviarLink}>
          <h2 className="font-serif text-lg text-slate-900">Acessar consultas</h2>
          <p className="mt-1 text-sm text-slate-600">
            Informe seu e-mail e enviamos um link de acesso. Sem senha para
            criar ou lembrar.
          </p>

          <label className="mt-5 block">
            <span className="text-sm font-medium text-slate-700">E-mail</span>
            <input
              name="email"
              type="email"
              required
              autoComplete="email"
              autoFocus
              className={CAMPO}
            />
          </label>

          {erro && <p className={ERRO}>{erro}</p>}

          <button type="submit" disabled={enviando} className={BOTAO}>
            {enviando ? "Enviando…" : "Enviar link de acesso"}
          </button>

          <button
            type="button"
            onClick={() => {
              setAba("medica");
              setErro(null);
            }}
            className="mt-5 block w-full text-center text-xs text-slate-400 hover:text-slate-600"
          >
            Acesso profissional
          </button>
        </form>
      ) : (
        <form onSubmit={entrarComCredenciais}>
          <h2 className="font-serif text-lg text-slate-900">Acesso profissional</h2>
          <p className="mt-1 text-sm text-slate-600">
            Senha e código do aplicativo autenticador.
          </p>

          <div className="mt-5 space-y-4">
            <label className="block">
              <span className="text-sm font-medium text-slate-700">E-mail</span>
              <input
                name="email"
                type="email"
                required
                autoComplete="username"
                autoFocus
                className={CAMPO}
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-slate-700">Senha</span>
              <input
                name="senha"
                type="password"
                required
                autoComplete="current-password"
                className={CAMPO}
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-slate-700">
                Código de 6 dígitos
              </span>
              {/* Sem esta linha, o campo é um enigma: pede seis dígitos e não
                  diz de onde vêm. Quem ainda não cadastrou o autenticador
                  simplesmente trava aqui, sem nada na tela para seguir. */}
              <span className="mt-0.5 block text-xs leading-relaxed text-slate-500">
                O código temporário do seu aplicativo autenticador — Google
                Authenticator, Authy, Microsoft ou 1Password. Ele muda a cada 30
                segundos.
              </span>
              <input
                name="totp"
                type="text"
                inputMode="numeric"
                pattern="\d{6}"
                maxLength={6}
                required
                autoComplete="one-time-code"
                placeholder="000000"
                className={`${CAMPO} font-mono text-lg tracking-[0.3em]`}
              />
            </label>
          </div>

          {/* Ajuda com AÇÃO, não só explicação. A versão anterior descrevia um
              comando de servidor — inútil para quem está travado na tela. */}
          <details className="mt-4 rounded-lg bg-slate-50 px-4 py-3">
            <summary className="cursor-pointer text-sm font-medium text-slate-700">
              Não tenho o código
            </summary>
            <div className="mt-3 space-y-3 text-sm leading-relaxed text-slate-600">
              <p>
                <strong className="text-slate-800">Primeira vez aqui?</strong>{" "}
                Se a conta ainda não tem senha nem aplicativo cadastrados, faça
                a configuração completa pelo navegador — senha, QR e
                confirmação, em dois minutos:
              </p>
              <a
                href="/primeiro-acesso"
                className="block rounded-lg bg-teal-800 px-4 py-2.5 text-center text-sm font-semibold text-white hover:bg-teal-900"
              >
                Configurar primeiro acesso
              </a>
              <p>
                <strong className="text-slate-800">
                  Já entrou antes e trocou de celular?
                </strong>{" "}
                Se você ainda consegue entrar por outro aparelho, cadastre o
                novo em <em>Agenda → Segurança</em>. Se perdeu o único
                aparelho, a redefinição é feita no servidor — por segurança,
                nunca por e-mail.
              </p>
              <p className="text-xs text-slate-500">
                Dica: o aplicativo mostra mais de uma conta com nome parecido?
                Use a que termina com{" "}
                <em>consulta.dralaishahmed.com.br</em> — ou apague as antigas.
              </p>
            </div>
          </details>

          {erro && <p className={ERRO}>{erro}</p>}

          <button type="submit" disabled={enviando} className={BOTAO}>
            {enviando ? "Entrando…" : "Entrar"}
          </button>

          <button
            type="button"
            onClick={() => {
              setAba("paciente");
              setErro(null);
            }}
            className="mt-5 block w-full text-center text-xs text-slate-400 hover:text-slate-600"
          >
            Sou paciente
          </button>
        </form>
      )}
    </div>
  );
}

const CAMPO =
  "mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:border-teal-700 focus:ring-1 focus:ring-teal-700";
const ERRO = "mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800";
const BOTAO =
  "mt-5 w-full rounded-xl bg-teal-800 px-6 py-3 text-sm font-semibold text-white hover:bg-teal-900 disabled:opacity-50";
