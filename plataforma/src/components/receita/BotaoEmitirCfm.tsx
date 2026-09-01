"use client";

/**
 * "Emitir pelo CFM" — Prescrição Eletrônica do Conselho Federal de Medicina.
 *
 * FASE 1 (SIMULAÇÃO, dormente atrás de CFM_ATIVO): a médica assina a receita no
 * IFRAME do CFM (ICP-Brasil via VIDaaS/gov.br); o CFM devolve a URL do PDF
 * assinado, que registramos na Receita.
 *
 * A lib do CFM (`integracao-prescricao-cfm`) é FRONTEND (iframe + postMessage) e
 * NÃO está publicada no npm (404 em 09/2026) — por isso é carregada em RUNTIME a
 * partir de `CFM_SCRIPT_URL` (self-host/CDN do CFM), como global
 * `integracaoPrescricaoCfm`. Sem essa URL, o botão avisa e não faz nada.
 *
 * Usa os métodos REAIS da lib: `new CfmIntegracaoPrescricao(ambiente)`,
 * `criarIframe(tipo, idPai)`, `enviarPrescricao(req)`.
 */

import { useState } from "react";
import type {
  CfmNomeAmbiente,
  CfmNomeTipoDocumento,
  CfmPrescricaoData,
  CfmRespostaData,
} from "@/lib/cfm/tipos";

interface CfmLib {
  CfmIntegracaoPrescricao: new (ambiente: unknown) => {
    criarIframe: (tipo: unknown, idElementoPai: string) => Promise<void>;
    enviarPrescricao: (requisicao: unknown) => Promise<CfmRespostaData>;
  };
  CfmAmbiente: Record<CfmNomeAmbiente, unknown>;
  CfmTipoDocumento: Record<CfmNomeTipoDocumento, unknown>;
}

function libGlobal(): CfmLib | undefined {
  return (window as unknown as { integracaoPrescricaoCfm?: CfmLib })
    .integracaoPrescricaoCfm;
}

function carregarLib(url: string): Promise<CfmLib> {
  return new Promise((resolve, reject) => {
    const existente = libGlobal();
    if (existente) return resolve(existente);
    const s = document.createElement("script");
    s.src = url;
    s.async = true;
    s.onload = () => {
      const g = libGlobal();
      if (g) resolve(g);
      else reject(new Error("O script do CFM carregou mas não expôs `integracaoPrescricaoCfm`."));
    };
    s.onerror = () =>
      reject(new Error("Não foi possível carregar a biblioteca do CFM."));
    document.body.appendChild(s);
  });
}

interface Props {
  receitaId: string;
  ambiente: CfmNomeAmbiente;
  tipoDocumento: CfmNomeTipoDocumento;
  prescricao: CfmPrescricaoData;
  /** URL do bundle da lib do CFM (env CFM_SCRIPT_URL). Vazio = não configurado. */
  scriptUrl?: string;
}

type Estado = "ocioso" | "processando" | "pronto" | "erro";

export function BotaoEmitirCfm({
  receitaId,
  ambiente,
  tipoDocumento,
  prescricao,
  scriptUrl,
}: Props) {
  const [estado, setEstado] = useState<Estado>("ocioso");
  const [erro, setErro] = useState<string | null>(null);
  const [docUrl, setDocUrl] = useState<string | null>(null);
  const containerId = `cfm-iframe-${receitaId}`;

  const emitir = async () => {
    setErro(null);
    if (!scriptUrl) {
      setEstado("erro");
      setErro(
        "A biblioteca do CFM ainda não está configurada (CFM_SCRIPT_URL). O " +
          "pacote npm não está publicado — aponte para o bundle da lib para habilitar.",
      );
      return;
    }
    setEstado("processando");
    try {
      const g = await carregarLib(scriptUrl);
      const integ = new g.CfmIntegracaoPrescricao(g.CfmAmbiente[ambiente]);
      // Carrega o iframe do CFM dentro do container abaixo.
      await integ.criarIframe(g.CfmTipoDocumento[tipoDocumento], containerId);

      // Token OAuth vem do NOSSO backend (client_secret é confidencial).
      const tokenResp = await fetch("/api/cfm/token-prescricao").then((r) => r.json());
      if (!tokenResp?.access_token) {
        throw new Error(tokenResp?.erro ?? "Token do CFM indisponível.");
      }

      // `enviarPrescricao` faz postMessage (que serializa em objeto plano), então
      // um objeto com os campos de CfmRequestMessage é equivalente a instanciar a
      // classe. A médica assina no iframe e a promise resolve com a resposta.
      const resposta = await integ.enviarPrescricao({
        accessToken: tokenResp.access_token,
        prescricao,
      });

      if (resposta?.tipo?.nome !== "SUCESSO" || !resposta.urlDocumento) {
        throw new Error(
          resposta?.mensagemErro ?? "O CFM não devolveu o documento assinado.",
        );
      }

      const salvar = await fetch(`/api/receita/${receitaId}/emitir-cfm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ urlDocumento: resposta.urlDocumento }),
      });
      const d = await salvar.json().catch(() => ({}));
      if (!salvar.ok) throw new Error(d.erro ?? "Falha ao registrar o documento do CFM.");

      setDocUrl(d.documentoUrl ?? resposta.urlDocumento);
      setEstado("pronto");
    } catch (e) {
      // A lib rejeita com a própria CfmResponseMessage em caso de erro do usuário.
      const msg =
        e instanceof Error
          ? e.message
          : (e as CfmRespostaData)?.mensagemErro ?? "Falha na emissão pelo CFM.";
      setEstado("erro");
      setErro(msg);
    }
  };

  if (estado === "pronto" && docUrl) {
    return (
      <a
        href={docUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="rounded-lg border border-teal-700 px-4 py-2 text-sm font-semibold text-teal-800 hover:bg-teal-50"
      >
        Ver documento do CFM
      </a>
    );
  }

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={() => void emitir()}
        disabled={estado === "processando"}
        title="Assinar e emitir pela Prescrição Eletrônica do CFM (ICP-Brasil)"
        className="rounded-lg border border-teal-700 px-4 py-2 text-sm font-semibold text-teal-800 hover:bg-teal-50 disabled:opacity-50"
      >
        {estado === "processando" ? "Emitindo no CFM…" : "Emitir pelo CFM"}
      </button>
      {erro && <span className="max-w-xs text-xs text-red-700">{erro}</span>}
      {/* Container do iframe do CFM (a lib injeta o iframe aqui). */}
      <div
        id={containerId}
        className={estado === "processando" ? "mt-2 h-[70vh] w-full" : "hidden"}
      />
    </span>
  );
}
