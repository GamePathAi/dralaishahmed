"use client";

/**
 * Sala de teleconsulta — paciente em destaque, médica em PiP, controles ao pé.
 *
 * O componente orquestra três coisas que precisam permanecer independentes:
 * a videochamada (Daily), a gravação (hook próprio) e o pipeline de notas.
 * Falha na gravação ou na IA NUNCA derruba a consulta — a médica continua
 * atendendo e redige o registro manualmente. Por isso cada etapa tem seu próprio
 * try/catch e nenhuma delas fecha a sala.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  DailyAudio,
  DailyProvider,
  useDaily,
  useLocalSessionId,
  useParticipantIds,
  useMediaTrack,
  useDailyEvent,
} from "@daily-co/daily-react";
import type {
  DailyEventObjectCameraError,
  DailyParticipant,
} from "@daily-co/daily-js";
import { useGravadorConsulta } from "./useGravadorConsulta";
import { PreSala } from "./PreSala";
import { IndicadorEscuta } from "./IndicadorEscuta";
import { PainelDiagnostico } from "./PainelDiagnostico";
import { NotaSessaoMedica } from "./NotaSessaoMedica";
import { ConsentimentoGravacao } from "./ConsentimentoGravacao";
import { ModalRevisaoNotas } from "./ModalRevisaoNotas";
import type { RelatorioClinico } from "@/lib/ia/notas-clinicas";
import { TIPO_AUDIO_CONSULTA } from "@/lib/tipos-midia";

interface Props {
  consultaId: string;
  salaUrl: string;
  token: string;
  papel: "MEDICA" | "PACIENTE";
  nomePaciente: string;
  crmMedica: string;
  /** Preferência da médica: SEMPRE oferece o assistente, MANUAL só quando ela
   *  inicia, DESLIGADO nunca. Controla o custo de transcrição por consulta. */
  modoAssistente: "SEMPRE" | "MANUAL" | "DESLIGADO";
}

export function SalaTeleconsulta(props: Props) {
  return (
    <DailyProvider url={props.salaUrl} token={props.token}>
      <Sala {...props} />

      {/*
        Sem isto, ninguém ouve ninguém.

        O `<video>` de cada participante recebe só a faixa de VÍDEO — o
        `srcObject` é montado com `useMediaTrack(id, "video")`. A faixa de áudio
        remota não estava ligada a elemento nenhum, então os dois lados se viam
        e não se escutavam. A gravação até funcionava (ela pega as faixas
        direto), o que tornava a falha ainda mais confusa: o assistente
        registrava uma conversa que os participantes não conseguiam ter.

        `DailyAudio` cria e gerencia os elementos de áudio de todos os
        participantes remotos, incluindo quem entra depois. Fica fora de
        `Sala` de propósito: ela retorna cedo nas telas de consentimento e de
        encerramento, e o áudio não pode depender de qual tela está montada.
      */}
      <DailyAudio />
    </DailyProvider>
  );
}

function Sala({
  consultaId,
  salaUrl,
  token,
  papel,
  nomePaciente,
  crmMedica,
  modoAssistente,
}: Props) {
  const daily = useDaily();
  const idLocal = useLocalSessionId();
  const idsRemotos = useParticipantIds({ filter: "remote" });
  const idRemoto = idsRemotos[0];

  const audioLocal = useMediaTrack(idLocal ?? "", "audio");
  const audioRemoto = useMediaTrack(idRemoto ?? "", "audio");
  const videoLocal = useMediaTrack(idLocal ?? "", "video");
  const videoRemoto = useMediaTrack(idRemoto ?? "", "video");

  // DESLIGADO: o assistente nunca é oferecido — pula o consentimento e a
  // gravação, a consulta é só vídeo.
  const [consentimento, setConsentimento] = useState<boolean | null>(
    modoAssistente === "DESLIGADO" ? false : null,
  );
  // MANUAL: a gravação não começa sozinha; só quando a médica inicia.
  const [assistenteIniciado, setAssistenteIniciado] = useState(
    modoAssistente !== "MANUAL",
  );
  const [micLigado, setMicLigado] = useState(true);
  const [camLigada, setCamLigada] = useState(true);
  const [processando, setProcessando] = useState(false);
  const [notas, setNotas] = useState<{
    registroId: string;
    relatorio: RelatorioClinico;
  } | null>(null);
  const [avisoIA, setAvisoIA] = useState<string | null>(null);
  // Sair da chamada não muda nada na tela por conta própria: o vídeo some e o
  // resto continua igual, o que se lê como botão quebrado. Este estado é o que
  // dá um "depois" à saída.
  const [encerrado, setEncerrado] = useState(false);
  // Qual passo do pipeline está rodando. Sem isto, "Processando registro…"
  // ficaria minutos na tela sem dizer se algo está acontecendo.
  const [etapa, setEtapa] = useState<string | null>(null);

  // Erro que aparece DENTRO da sala (câmera caiu no meio da consulta, etc.).
  const [erroConexao, setErroConexao] = useState<string | null>(null);

  // A entrada na chamada agora sai de um gesto (botão da pré-sala), não da
  // montagem — no iOS o Safari só concede câmera/microfone dentro de um gesto,
  // então o `join()` automático rejeitava. `entrou` separa a pré-sala da sala.
  const [entrou, setEntrou] = useState(false);
  const [entrando, setEntrando] = useState(false);
  const [erroEntrada, setErroEntrada] = useState<string | null>(null);

  /**
   * Entra na chamada — chamado pelo botão "Entrar na consulta" da pré-sala, já
   * dentro de um gesto do usuário e com os dispositivos autorizados por
   * `startCamera`. O `join()` era obrigatório (sem ele os dois lados ficavam em
   * "aguardando o outro" para sempre) e antes rodava na montagem, o que quebrava
   * no iOS. Agora sai daqui.
   *
   * A pré-sala já validou a credencial com `preAuth`, então uma falha aqui é de
   * rede/mídia — mensagem própria e um "tentar de novo" que não recarrega a
   * página, distinta do erro de credencial.
   */
  const entrarNaChamada = useCallback(
    async ({ camLigada: cam, micLigado: mic }: { camLigada: boolean; micLigado: boolean }) => {
      if (!daily || entrando) return;

      // Guard contra join duplo (StrictMode roda o gesto uma vez, mas um
      // duplo-toque no mobile pode disparar dois): se já está entrando ou dentro
      // da sala, não abre outra conexão.
      const estado = daily.meetingState();
      if (estado === "joining-meeting" || estado === "joined-meeting") {
        setEntrou(true);
        return;
      }

      setEntrando(true);
      setErroEntrada(null);
      try {
        await daily.join({ url: salaUrl, token });
        // Espelha nos controles da sala o que a pessoa escolheu na pré-sala.
        setMicLigado(mic);
        setCamLigada(cam);
        daily.setLocalAudio(mic);
        daily.setLocalVideo(cam);
        setEntrou(true);
      } catch (e) {
        console.error("[sala] join falhou", e);
        setErroEntrada(
          "Não foi possível conectar à sala agora. Verifique sua internet e " +
            "toque em “Entrar na consulta” de novo.",
        );
      } finally {
        setEntrando(false);
      }
    },
    [daily, salaUrl, token, entrando],
  );

  /**
   * Falha ao pegar câmera/microfone.
   *
   * A Daily entra na sala mesmo sem conseguir a câmera: `join()` resolve
   * normalmente e o vídeo simplesmente nunca aparece. Sem escutar este evento
   * a falha é silenciosa dos dois lados — quem está sem câmera não descobre, e
   * do outro lado fica um retângulo vazio sem explicação.
   */
  useDailyEvent(
    "camera-error",
    useCallback((evento: DailyEventObjectCameraError) => {
      console.error("[sala] falha ao acessar câmera/microfone", evento);

      // Antes de entrar, quem trata o erro de dispositivo é a pré-sala (com o
      // fluxo de permissão e o "tentar de novo"). Este banner é só para a câmera
      // que cai NO MEIO da consulta, já dentro da sala.
      if (!entrou) return;

      const tipo = evento.error?.type;

      // Falta de câmera NÃO interrompe a consulta — teleconsulta por áudio é
      // atendimento válido. A mensagem tem que dizer isso, senão o paciente
      // acha que precisa resolver antes de ser atendido e desiste. Só o
      // microfone é indispensável.
      const microfoneAfetado =
        tipo === "mic-in-use" || tipo === "cam-mic-in-use" || tipo === "permissions";

      setErroConexao(
        tipo === "permissions"
          ? "O navegador bloqueou a câmera ou o microfone. Libere o acesso no " +
              "ícone à esquerda da barra de endereços e recarregue a página."
          : tipo === "not-found"
            ? "Nenhuma câmera foi encontrada neste aparelho. A consulta " +
              "continua normalmente por áudio."
            : tipo === "cam-in-use" ||
                tipo === "mic-in-use" ||
                tipo === "cam-mic-in-use"
              ? `A câmera está sendo usada por outro programa ou por outra janela do navegador. ${
                  microfoneAfetado
                    ? "O microfone também — sem ele a consulta não funciona. Feche o outro e recarregue."
                    : "A consulta continua normalmente por áudio; o vídeo é que não aparece."
                }`
              : "Não foi possível acessar a câmera. A consulta continua por " +
                "áudio; recarregue a página se quiser tentar o vídeo de novo.",
      );
    }, [entrou]),
  );

  const streamDe = (track?: MediaStreamTrack | null) =>
    track ? new MediaStream([track]) : null;

  const gravador = useGravadorConsulta({
    consultaId,
    consentimentoAceito: consentimento === true,
    streamLocal: streamDe(audioLocal.persistentTrack),
    streamRemota: streamDe(audioRemoto.persistentTrack),
  });

  // Áudio da consulta, garantido FORA do botão de encerrar.
  //
  // O áudio da gravação vive só na memória do navegador e antes só era enviado
  // quando a médica clicava "Encerrar consulta". Se o PACIENTE saía primeiro
  // (ou caía a conexão), o `participant-left` descartava tudo e a consulta
  // terminava sem transcrição — confirmado em produção (toda consulta com
  // consentimento aceito ficou sem `Transcricao`). Agora, quando o paciente sai
  // gravando, o áudio é assegurado (finalizado, enviado e a transcrição
  // iniciada) em segundo plano. Estes refs guardam o resultado para a médica
  // não capturar/enviar de novo ao encerrar, e a promessa em voo evita corrida
  // entre a saída do paciente e o clique de encerrar.
  const audioBlobRef = useRef<Blob | null>(null);
  const audioKeyRef = useRef<string | null>(null);
  const asseguracaoRef = useRef<Promise<void> | null>(null);

  // A gravação começa quando os dois lados estão na sala e há aceite —
  // não no momento em que a médica entra sozinha.
  //
  // A faixa de áudio LOCAL precisa existir antes de tentar. Ela é negociada
  // pela WebRTC e costuma chegar depois de o participante remoto aparecer:
  // disparar em `idRemoto` sozinho pegava `streamLocal` nulo, o `iniciar()`
  // parava em "Microfone indisponível" e o estado virava "erro" — de onde o
  // efeito nunca mais tentava, porque ele só roda com estado "ocioso".
  // Resultado: consulta inteira sem gravação, descoberto só no fim.
  const faixaLocalPronta = !!audioLocal.persistentTrack;

  useEffect(() => {
    if (
      papel === "MEDICA" &&
      consentimento === true &&
      // MANUAL não grava sozinho: espera a médica iniciar (economiza o custo
      // de transcrição nas consultas em que ela não quer rascunho).
      assistenteIniciado &&
      idRemoto &&
      faixaLocalPronta &&
      gravador.estado === "ocioso" &&
      // Já asseguramos/capturamos um trecho (paciente saiu e voltou): não
      // reinicia a gravação numa reconexão — senão o novo trecho seria gravado
      // e depois descartado em silêncio, e a transcrição rodaria só no primeiro.
      !audioKeyRef.current &&
      !audioBlobRef.current
    ) {
      gravador.iniciar();
    }
  }, [papel, consentimento, assistenteIniciado, idRemoto, faixaLocalPronta, gravador]);

  // Sobe um blob de áudio por URL pré-assinada e devolve a `audioKey`, ou uma
  // mensagem de erro pronta para a tela. Separa o erro de REDE (fetch lança —
  // tipicamente CSP bloqueando o bucket) do erro de RESPOSTA do S3 (que traz o
  // <Code> exato: SignatureDoesNotMatch, AccessDenied, CORS).
  const enviarAudio = useCallback(
    async (audio: Blob): Promise<{ audioKey: string } | { erro: string }> => {
      // Presign: uma falha de rede aqui não pode virar exceção genérica —
      // devolve `{erro}` como o resto do fluxo.
      let presign: Response;
      try {
        presign = await fetch(`/api/consultas/${consultaId}/audio`, {
          method: "POST",
        });
      } catch (e) {
        console.error("[sala] falha ao pedir a URL de upload do áudio", e);
        return { erro: "Não foi possível preparar o envio do áudio. O registro deve ser redigido manualmente." };
      }
      if (!presign.ok) {
        console.error("[sala] presign do áudio falhou", presign.status);
        return { erro: "Não foi possível preparar o envio do áudio. O registro deve ser redigido manualmente." };
      }
      const { url, audioKey } = (await presign.json()) as {
        url: string;
        audioKey: string;
      };

      // O Content-Type precisa ser IDÊNTICO ao que assinou a URL.
      let envio: Response;
      try {
        envio = await fetch(url, {
          method: "PUT",
          body: audio,
          headers: { "Content-Type": TIPO_AUDIO_CONSULTA },
        });
      } catch (e) {
        console.error("[sala] upload bloqueado antes de sair do navegador", e);
        return {
          erro:
            "O navegador bloqueou o envio do áudio para o armazenamento. " +
            "Provavelmente a política de segurança (CSP) não permite o endereço " +
            "do bucket. O registro deve ser redigido manualmente.",
        };
      }

      if (!envio.ok) {
        const detalhe = await envio.text().catch(() => "");
        const codigo = detalhe.match(/<Code>([^<]+)<\/Code>/)?.[1] ?? "";
        console.error("[sala] upload do áudio falhou", envio.status, detalhe);
        return {
          erro:
            `Não foi possível enviar o áudio (HTTP ${envio.status}${codigo ? ` — ${codigo}` : ""}). ` +
            "O registro desta consulta deve ser redigido manualmente.",
        };
      }

      return { audioKey: audioKey as string };
    },
    [consultaId],
  );

  // Dispara o job de transcrição (uma vez). É o POST que CRIA a linha de
  // `Transcricao` com `jobNome` — a partir daí o cron consegue retomar e
  // concluir mesmo que a médica saia sem esperar. `keepalive` para sobreviver à
  // navegação.
  const dispararTranscricao = useCallback(
    async (audioKey: string) => {
      await fetch(`/api/consultas/${consultaId}/notas`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audioKey }),
        keepalive: true,
      }).catch((e) =>
        console.warn("[sala] não foi possível iniciar a transcrição", e),
      );
    },
    [consultaId],
  );

  // Finaliza e ENVIA o áudio já, sem esperar o botão de encerrar — senão o áudio
  // (só em memória) se perderia quando o paciente sai ou a conexão da médica
  // cai. Inicia o job de transcrição; o cron conclui o resto.
  //
  // A função é DONA de `asseguracaoRef`: guarda a própria promessa em voo e a
  // devolve em chamadas repetidas, para o `encerrar` esperar o trabalho REAL (e
  // não uma promessa vazia) e nunca capturar/enviar duas vezes. Em caso de
  // falha, libera o ref para nova tentativa; o blob fica guardado para o retry.
  const assegurarAudio = useCallback((): Promise<void> => {
    if (asseguracaoRef.current) return asseguracaoRef.current;
    if (audioKeyRef.current) return Promise.resolve();

    const p = (async () => {
      try {
        const audio = audioBlobRef.current ?? (await gravador.encerrar());
        if (!audio) return;
        audioBlobRef.current = audio;
        const r = await enviarAudio(audio);
        if ("audioKey" in r) {
          audioKeyRef.current = r.audioKey;
          await dispararTranscricao(r.audioKey);
        } else {
          console.warn("[sala] não foi possível assegurar o áudio:", r.erro);
        }
      } catch (e) {
        console.error("[sala] falha ao assegurar o áudio da consulta", e);
      } finally {
        // Sucesso deixa a promessa resolvida no ref (o encerrar espera e segue
        // pelo audioKeyRef). Falha zera para permitir nova tentativa.
        if (!audioKeyRef.current) asseguracaoRef.current = null;
      }
    })();

    asseguracaoRef.current = p;
    return p;
  }, [gravador, enviarAudio, dispararTranscricao]);

  // Se o paciente sai da sala com a gravação em andamento, o áudio é ASSEGURADO
  // (finalizado, enviado e transcrição iniciada) em vez de descartado — a
  // consulta aconteceu e a médica quer o rascunho. Gravação curta/vazia (ex.:
  // paciente que entrou e saiu na hora) vira transcrição vazia e não gera
  // rascunho, então não há risco de "prontuário de consulta que não aconteceu".
  //
  // A contagem vem de `daily.participants()`, e não do `idRemoto` do render:
  // quando este evento dispara, o estado do React ainda não refletiu a saída,
  // então `idRemoto` continua preenchido e a condição nunca era verdadeira.
  useDailyEvent(
    "participant-left",
    useCallback(() => {
      if (gravador.estado !== "gravando") return;
      const restantes = Object.values(daily?.participants() ?? {}).filter(
        (p) => !p.local,
      );
      if (restantes.length === 0) void assegurarAudio();
    }, [daily, gravador, assegurarAudio]),
  );

  // Fim da chamada. Para o paciente, mostra a tela de encerramento (saída
  // própria ou remoção pela médica). Para a MÉDICA, se a conexão dela cair com
  // a gravação em andamento, assegura o áudio — a aba segue aberta, então dá
  // para subir; não encerra a consulta (o encerrar de fato é o botão).
  useDailyEvent(
    "left-meeting",
    useCallback(() => {
      if (papel === "PACIENTE") {
        setEncerrado(true);
        return;
      }
      if (gravador.estado === "gravando") void assegurarAudio();
    }, [papel, gravador, assegurarAudio]),
  );

  // Rede de segurança contra a perda que sobra: a médica fecha a aba / navega
  // com a gravação rodando (ou com áudio ainda não confirmado no servidor).
  // O áudio vive só na memória e não dá para subir um blob de MB no `unload`,
  // então o máximo honesto é PEDIR CONFIRMAÇÃO antes de sair. Só para a médica.
  useEffect(() => {
    if (papel !== "MEDICA") return;
    const aviso = (e: BeforeUnloadEvent) => {
      const pendente =
        gravador.estado === "gravando" ||
        gravador.estado === "finalizando" ||
        (!!audioBlobRef.current && !audioKeyRef.current) ||
        (!!asseguracaoRef.current && !audioKeyRef.current);
      if (pendente) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", aviso);
    return () => window.removeEventListener("beforeunload", aviso);
  }, [papel, gravador]);

  const alternarMic = () => {
    daily?.setLocalAudio(!micLigado);
    setMicLigado((v) => !v);
  };
  const alternarCam = () => {
    daily?.setLocalVideo(!camLigada);
    setCamLigada((v) => !v);
  };

  /** Paciente saindo. Não encerra a consulta — ele pode voltar. */
  const sairDaSala = async () => {
    setProcessando(true);
    try {
      await daily?.leave();
    } finally {
      setProcessando(false);
      setEncerrado(true);
    }
  };

  const encerrarConsulta = async () => {
    setProcessando(true);
    try {
      // Marca a consulta como encerrada no servidor NA HORA, para não depender do
      // cron quando a médica encerra de fato pela sala. Best-effort: falha de rede
      // não pode travar o fim da consulta nem o processamento de áudio — mesma
      // filosofia do `eject` abaixo. (O cron cobre quem sai sem clicar.)
      if (papel === "MEDICA") {
        await fetch(`/api/consultas/${consultaId}/encerrar`, { method: "POST" }).catch(
          (e) => console.warn("[sala] não foi possível marcar encerrada no servidor", e),
        );
      }

      // Se o paciente saiu antes, o áudio já está sendo assegurado em segundo
      // plano; espera concluir para não capturar nem enviar duas vezes.
      if (asseguracaoRef.current) await asseguracaoRef.current.catch(() => {});

      const audio = audioBlobRef.current ?? (await gravador.encerrar());
      // Guarda o blob para o aviso de "não feche" (beforeunload) valer também
      // durante o upload, e para o retry preservar o áudio.
      if (audio) audioBlobRef.current = audio;

      // Tira o paciente da sala ANTES de sair.
      //
      // `leave()` só remove quem chama. O paciente continuava sozinho numa
      // sala encerrada, vendo "aguardando a médica" — esperando alguém que
      // não vai voltar. A médica entra como dona da sala (`is_owner`), então
      // pode encerrar para os dois.
      //
      // Falha aqui não impede o encerramento: a sala expira sozinha pelo
      // `exp`, e travar o fim da consulta seria pior que uma saída deselegante.
      try {
        const remotos = Object.values(daily?.participants() ?? {}).filter(
          (p): p is DailyParticipant => !!p && !p.local,
        );
        if (remotos.length > 0) {
          await daily?.updateParticipants(
            Object.fromEntries(
              remotos.map((p) => [p.session_id, { eject: true }]),
            ),
          );
        }
      } catch (e) {
        console.warn("[sala] não foi possível encerrar para o paciente", e);
      }

      await daily?.leave();
      setEncerrado(true);

      if (!audio) {
        setAvisoIA(
          "Consulta encerrada sem gravação. O registro deve ser redigido manualmente.",
        );
        return;
      }

      // 1. sobe o áudio se ainda não foi (o caminho "paciente saiu antes" já
      // subiu e guardou a audioKey).
      let audioKey = audioKeyRef.current;
      if (!audioKey) {
        const r = await enviarAudio(audio);
        if ("erro" in r) {
          setAvisoIA(r.erro);
          return;
        }
        audioKey = r.audioKey;
        audioKeyRef.current = audioKey;
      }

      // 2. transcreve + estrutura
      //
      // A transcrição da AWS é um job. Cada POST empurra o pipeline um passo e
      // responde na hora — segurar uma requisição por minutos daria 504 no
      // nginx. Aqui a gente insiste até sair `pronto`.
      const LIMITE_MIN = 15;
      const INTERVALO_MS = 5000;
      const ate = Date.now() + LIMITE_MIN * 60_000;

      while (Date.now() < ate) {
        const resposta = await fetch(`/api/consultas/${consultaId}/notas`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ audioKey }),
          // Sobrevive à navegação. A primeira chamada é a que DISPARA o job na
          // AWS; se ela for abortada porque a médica saiu da página, o job
          // nunca existe e o áudio se perde. O corpo é minúsculo, bem dentro
          // do limite do `keepalive`.
          keepalive: true,
        });
        const dados = await resposta.json();

        if (!resposta.ok) {
          setAvisoIA(dados.erro ?? "Falha ao gerar o rascunho.");
          return;
        }

        if (dados.estado === "pronto") {
          setNotas({ registroId: dados.registroId, relatorio: dados.relatorio });
          return;
        }

        setEtapa("Transcrevendo o áudio da consulta…");
        await new Promise((r) => setTimeout(r, INTERVALO_MS));
      }

      setAvisoIA(
        `A transcrição passou de ${LIMITE_MIN} minutos e ainda não terminou. ` +
          "Ela continua rodando — o rascunho aparece na consulta quando ficar " +
          "pronto. Se preferir não esperar, redija o registro manualmente.",
      );
    } catch {
      setAvisoIA(
        "Falha ao processar o áudio. A consulta foi encerrada normalmente — " +
          "redija o registro manualmente.",
      );
    } finally {
      setProcessando(false);
      setEtapa(null);
    }
  };

  const assinar = async (registroId: string, relatorio: RelatorioClinico) => {
    const r = await fetch(`/api/prontuario/${registroId}/assinar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ relatorio }),
    });
    if (!r.ok) throw new Error("assinatura falhou");
    setNotas(null);
  };

  // ---- depois de sair ----------------------------------------------------
  // O modal de revisão continua montado por cima: se a IA gerou rascunho, a
  // médica revisa e assina a partir daqui, sem precisar caçar a consulta.
  if (encerrado) {
    return (
      <>
        <div className="grid h-dvh place-items-center bg-slate-950 px-6">
          <div className="w-full max-w-sm rounded-2xl bg-white p-8 text-center shadow-lg">
            <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-full bg-slate-100 text-xl">
              {papel === "MEDICA" ? "✓" : "👋"}
            </div>
            <h2 className="font-serif text-lg text-slate-900">
              {papel === "MEDICA" ? "Consulta encerrada" : "Você saiu da sala"}
            </h2>

            <p className="mx-auto mt-2 max-w-xs text-sm leading-relaxed text-slate-600">
              {papel === "MEDICA"
                ? (etapa ?? avisoIA ??
                  "A sala foi fechada para os dois participantes.")
                : "A chamada foi encerrada. Se a consulta ainda não terminou, você pode entrar novamente."}
            </p>

            <div className="mt-6 flex flex-col gap-2">
              {papel === "MEDICA" ? (
                processando ? (
                  /*
                   * Enquanto o pipeline roda, esta tela NÃO oferece saída.
                   *
                   * A versão anterior mostrava "Redigir o registro" assim que a
                   * chamada era encerrada — antes de a transcrição começar. A
                   * médica clicava, a navegação abortava o `fetch` que dispara o
                   * job na AWS, e o áudio se perdia. A tela convidava a destruir
                   * o próprio trabalho.
                   */
                  <div className="rounded-xl bg-slate-100 px-6 py-4 text-sm text-slate-700">
                    <div className="flex items-center justify-center gap-2 font-medium text-slate-900">
                      <span className="h-2 w-2 animate-pulse rounded-full bg-teal-700" />
                      {etapa ?? "Processando…"}
                    </div>
                    <p className="mt-2 leading-relaxed">
                      Isso leva menos de um minuto.{" "}
                      <strong>Não feche nem saia desta página</strong> — o
                      rascunho é montado aqui.
                    </p>
                  </div>
                ) : (
                  <>
                    <a
                      href={`/atendimento/${consultaId}/registro`}
                      className="rounded-xl bg-teal-800 px-6 py-3 text-sm font-semibold text-white hover:bg-teal-900"
                    >
                      Redigir o registro
                    </a>
                    <a
                      href="/agenda"
                      className="rounded-xl border border-slate-300 px-6 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      Voltar à agenda
                    </a>
                  </>
                )
              ) : (
                <>
                  <button
                    onClick={() => window.location.reload()}
                    className="rounded-xl bg-teal-800 px-6 py-3 text-sm font-semibold text-white hover:bg-teal-900"
                  >
                    Entrar novamente
                  </button>
                  <a
                    href="/minhas-consultas"
                    className="rounded-xl border border-slate-300 px-6 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    Minhas consultas
                  </a>
                </>
              )}
            </div>

            {papel === "PACIENTE" && (
              <p className="mx-auto mt-5 max-w-xs text-xs leading-relaxed text-slate-500">
                Em caso de urgência, não aguarde. Procure o serviço de saúde
                mais próximo ou ligue 192 (SAMU).
              </p>
            )}
          </div>
        </div>

        {notas && (
          <ModalRevisaoNotas
            registroId={notas.registroId}
            relatorioInicial={notas.relatorio}
            nomePaciente={nomePaciente}
            crmMedica={crmMedica}
            aoAssinar={assinar}
            aoFechar={() => setNotas(null)}
          />
        )}
      </>
    );
  }

  // ---- consentimento antes de qualquer captura --------------------------
  // Fluxo de consentimento intacto e PRIMEIRO: o paciente decide sobre a
  // gravação antes de qualquer coisa; a pré-sala (dispositivos) vem depois.
  if (consentimento === null) {
    return (
      <ConsentimentoGravacao
        consultaId={consultaId}
        papel={papel}
        aoResponder={setConsentimento}
      />
    );
  }

  // ---- pré-sala: nada de câmera até um toque -----------------------------
  // Vale para os dois papéis. A médica vê um texto mais curto, mas o `join()`
  // dela também precisa sair de um gesto no iOS.
  if (!entrou) {
    return (
      <PreSala
        salaUrl={salaUrl}
        token={token}
        papel={papel}
        aoEntrar={entrarNaChamada}
        erroEntrada={erroEntrada}
        entrando={entrando}
      />
    );
  }

  return (
    <div className="relative flex h-dvh flex-col bg-slate-950">
      {/* vídeo do paciente em destaque */}
      <div className="relative flex-1 overflow-hidden">
        {idRemoto ? (
          <VideoParticipante
            sessionId={idRemoto}
            rotulo={papel === "MEDICA" ? nomePaciente : "A médica"}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-slate-400">
            <div className="text-center">
              <div className="mx-auto mb-4 h-14 w-14 animate-pulse rounded-full bg-slate-800" />
              <p className="text-sm">
                {papel === "MEDICA"
                  ? "Aguardando o paciente entrar na sala…"
                  : "Aguardando a médica…"}
              </p>
            </div>
          </div>
        )}

        {/* PiP local */}
        {idLocal && (
          <div className="absolute bottom-4 right-4 h-32 w-24 overflow-hidden rounded-xl border border-white/15 shadow-lg sm:h-40 sm:w-30">
            <VideoParticipante
              sessionId={idLocal}
              rotulo="Você"
              compacto
              espelhado
              className="h-full w-full object-cover"
            />
          </div>
        )}

        {/* Diagnóstico — só a médica. "Não estou ouvindo" e "ele não me vê"
            apontam para causas diferentes que nenhuma tela mostrava. */}
        {papel === "MEDICA" && (
          <div className="absolute right-4 top-4 w-64">
            <PainelDiagnostico
              participantes={idsRemotos.length}
              videoLocal={videoLocal}
              audioLocal={audioLocal}
              videoRemoto={videoRemoto}
              audioRemoto={audioRemoto}
              micLigado={micLigado}
              camLigada={camLigada}
              estadoGravacao={gravador.estado}
              bytesGravados={gravador.bytes}
            />
          </div>
        )}

        {/* indicador de escuta — visível para os dois lados */}
        <div className="absolute left-4 top-4">
          <IndicadorEscuta
            estado={gravador.estado}
            duracaoSeg={gravador.duracaoSeg}
            nivel={gravador.nivel}
            bytes={gravador.bytes}
            // O selo aparece para os dois — exigência ética. O medidor de voz é
            // instrumento de trabalho da médica; ao paciente ele só somaria
            // ansiedade sobre o próprio volume no meio da consulta.
            detalhado={papel === "MEDICA"}
          />
        </div>

        {/* Anotações da médica — canto inferior esquerdo, acima dos controles.
            Autosave; fonte de apoio ao registro pós-consulta. */}
        {papel === "MEDICA" && (
          <div className="absolute bottom-4 left-4 z-10">
            <NotaSessaoMedica consultaId={consultaId} />
          </div>
        )}
      </div>

      {erroConexao && (
        <div className="bg-red-100 px-4 py-2.5 text-center text-sm text-red-900">
          {erroConexao}
        </div>
      )}

      {/* A pílula do indicador dizia só "falha no assistente", e a médica
          descobria que não havia gravação no fim da consulta — quando não dá
          mais para refazer. A mensagem precisa aparece aqui, na hora, e só
          para ela: é problema operacional dela, não do paciente. */}
      {papel === "MEDICA" && gravador.erro && (
        <div className="bg-amber-100 px-4 py-2.5 text-center text-sm text-amber-900">
          {gravador.erro} O assistente não vai gerar rascunho — o registro
          desta consulta terá de ser redigido manualmente.
        </div>
      )}

      {avisoIA && (
        <div className="bg-amber-100 px-4 py-2.5 text-center text-sm text-amber-900">
          {avisoIA}
        </div>
      )}

      {/* controles */}
      <div className="flex items-center justify-center gap-3 bg-slate-900 px-4 py-4">
        <BotaoControle ativo={micLigado} onClick={alternarMic} rotulo="Microfone">
          {micLigado ? "🎙" : "🔇"}
        </BotaoControle>
        <BotaoControle ativo={camLigada} onClick={alternarCam} rotulo="Câmera">
          {camLigada ? "📹" : "🚫"}
        </BotaoControle>

        {/* Modo MANUAL: a médica decide ativar o assistente. Só aparece quando
            o paciente já consentiu e a gravação ainda não começou — clicar
            inicia a captura (e, aí sim, o custo de transcrição). */}
        {papel === "MEDICA" &&
          modoAssistente === "MANUAL" &&
          consentimento === true &&
          !assistenteIniciado && (
            <button
              onClick={() => setAssistenteIniciado(true)}
              className="ml-3 rounded-full bg-teal-700 px-5 py-3 text-sm font-semibold text-white hover:bg-teal-800"
            >
              Iniciar assistente de anotação
            </button>
          )}

        {papel === "MEDICA" ? (
          <button
            onClick={encerrarConsulta}
            disabled={processando}
            className="ml-3 rounded-full bg-red-600 px-6 py-3 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
          >
            {processando ? (etapa ?? "Encerrando…") : "Encerrar consulta"}
          </button>
        ) : (
          <button
            onClick={sairDaSala}
            disabled={processando}
            className="ml-3 rounded-full bg-slate-700 px-6 py-3 text-sm font-semibold text-white hover:bg-slate-600 disabled:opacity-50"
          >
            {processando ? "Saindo…" : "Sair da sala"}
          </button>
        )}
      </div>

      {notas && (
        <ModalRevisaoNotas
          registroId={notas.registroId}
          relatorioInicial={notas.relatorio}
          nomePaciente={nomePaciente}
          crmMedica={crmMedica}
          aoAssinar={assinar}
          aoFechar={() => setNotas(null)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------- auxiliares

/**
 * Vídeo de um participante — ou a explicação de por que não há vídeo.
 *
 * Um `<video>` sem faixa não fica preto: o navegador desenha o próprio
 * placeholder cinza, que se lê como "a plataforma quebrou". Como câmera fora do
 * ar é o estado mais comum de uma teleconsulta (permissão negada, webcam presa
 * em outro programa, botão desligado), ele merece uma tela que diga qual dos
 * casos é.
 */
function VideoParticipante({
  sessionId,
  rotulo,
  compacto = false,
  espelhado = false,
  className = "",
}: {
  sessionId: string;
  rotulo: string;
  compacto?: boolean;
  espelhado?: boolean;
  className?: string;
}) {
  const video = useMediaTrack(sessionId, "video");
  const ref = useCallback(
    (el: HTMLVideoElement | null) => {
      if (!el) return;
      // Limpar quando a faixa some importa: sem isto o vídeo congela no último
      // quadro, e uma câmera que caiu vira uma pessoa imóvel na tela.
      el.srcObject = video.persistentTrack
        ? new MediaStream([video.persistentTrack])
        : null;
    },
    [video.persistentTrack],
  );

  if (!video.persistentTrack || video.isOff) {
    // `blocked` é permissão negada ou webcam tomada por outro programa; `off`
    // é decisão de quem está do outro lado. Confundir os dois faz a pessoa
    // procurar defeito onde não há.
    const motivo = video.blocked?.byPermissions
      ? "Câmera bloqueada no navegador"
      : video.blocked?.byDeviceInUse
        ? "Câmera em uso por outro programa"
        : video.blocked?.byDeviceMissing
          ? "Sem câmera neste aparelho"
          : "Câmera desligada";

    return (
      <div
        className={`${className} grid place-items-center bg-slate-800`}
        role="img"
        aria-label={`${rotulo}: ${motivo.toLowerCase()}`}
      >
        <div className="px-2 text-center">
          <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-slate-700 text-xl">
            🚫
          </div>
          <p className="mt-2 text-xs font-medium text-slate-200">{rotulo}</p>
          {!compacto && (
            <p className="mt-1 text-xs text-slate-400">{motivo}</p>
          )}
        </div>
      </div>
    );
  }

  return (
    <video
      ref={ref}
      autoPlay
      playsInline
      muted={espelhado}
      className={`${className} ${espelhado ? "scale-x-[-1]" : ""} bg-slate-900`}
    />
  );
}

function BotaoControle({
  ativo,
  onClick,
  rotulo,
  children,
}: {
  ativo: boolean;
  onClick: () => void;
  rotulo: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={rotulo}
      aria-pressed={ativo}
      className={`grid h-12 w-12 place-items-center rounded-full text-lg transition ${
        ativo ? "bg-slate-700 hover:bg-slate-600" : "bg-red-600 hover:bg-red-700"
      }`}
    >
      {children}
    </button>
  );
}
