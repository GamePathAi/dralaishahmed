"use client";

/**
 * Pré-sala da teleconsulta — o passo que faltava antes de entrar na chamada.
 *
 * O bug que ela conserta: o `join()` era disparado na montagem, sem gesto do
 * usuário. O Safari do iOS só concede câmera/microfone DENTRO de um gesto, então
 * a captura falhava e o `join()` rejeitava — e a mensagem de erro mandava o
 * paciente mexer numa permissão que estava correta. Aqui nada toca em câmera até
 * a pessoa tocar num botão, e cada causa de falha vira uma mensagem própria.
 *
 * A ordem importa e é a da própria Daily: `preAuth` (valida credencial, sem
 * câmera) → `startCamera` (pede os dispositivos, no gesto) → `join` (no gesto).
 * Separar `preAuth` de `startCamera` é o que distingue "seu link venceu" de
 * "sua câmera está bloqueada".
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  useDaily,
  useDevices,
  useLocalSessionId,
  useMediaTrack,
  useAudioLevel,
} from "@daily-co/daily-react";
import type { DailyEventObjectCameraError } from "@daily-co/daily-js";

/** Espelha o `MIN_ANTES` do servidor: a sala abre 15 min antes do horário. */
const MIN_ANTES_MS = 15 * 60_000;

interface Props {
  salaUrl: string;
  token: string;
  papel: "MEDICA" | "PACIENTE";
  /**
   * Dispara o `join()`. Fica no componente pai porque é ele que controla a
   * transição para a sala e o guard contra join duplo. Recebe o estado escolhido
   * para o pai espelhar nos controles da chamada.
   */
  aoEntrar: (opcoes: { camLigada: boolean; micLigado: boolean }) => void;
  /** Erro de rede/join vindo do pai, mostrado na tela de teste com "tentar de novo". */
  erroEntrada: string | null;
  /** true enquanto o `join()` do pai está em andamento. */
  entrando: boolean;
}

type Fase =
  | "validando" // preAuth rodando
  | "credencial" // bloqueio por credencial (link fora da janela ou sala removida)
  | "explicacao" // Etapa 1: avisa antes de pedir câmera/microfone
  | "preparando" // startCamera em andamento
  | "dispositivo" // bloqueio de dispositivo (permissão, em uso, não encontrado)
  | "testando"; // Etapa 2: preview, medidor de voz, seleção de dispositivos

/** Lê `nbf`/`exp` (em ms) do JWT da Daily sem depender de rede nem de biblioteca. */
function lerJanelaToken(token: string): { nbf: number | null; exp: number | null } {
  try {
    const parte = token.split(".")[1];
    if (!parte) return { nbf: null, exp: null };
    const base64 = parte.replace(/-/g, "+").replace(/_/g, "/");
    const payload = JSON.parse(atob(base64)) as { nbf?: number; exp?: number };
    return {
      nbf: payload.nbf ? payload.nbf * 1000 : null,
      exp: payload.exp ? payload.exp * 1000 : null,
    };
  } catch {
    return { nbf: null, exp: null };
  }
}

const ehIOS = () =>
  typeof navigator !== "undefined" &&
  (/iP(hone|ad|od)/.test(navigator.userAgent) ||
    // iPad em iOS 13+ se apresenta como Mac; o toque na tela o denuncia.
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));

/** Instrução de permissão específica por plataforma — no iOS o caminho é outro. */
function mensagemPermissao(): string {
  return ehIOS()
    ? "O acesso à câmera e ao microfone está bloqueado. No iPhone/iPad, abra " +
        "Ajustes › Safari › Câmera e Microfone e permita para este site — depois " +
        "volte e toque em “Tentar de novo”. (No iOS, uma vez negado, o navegador " +
        "não pergunta outra vez; só os Ajustes reabrem o acesso.)"
    : "O navegador bloqueou a câmera e o microfone. Toque no ícone de cadeado ou " +
        "de câmera à esquerda da barra de endereços, permita o acesso e toque em " +
        "“Tentar de novo”.";
}

export function PreSala({ token, papel, aoEntrar, erroEntrada, entrando }: Props) {
  const daily = useDaily();
  const idLocal = useLocalSessionId();
  const videoLocal = useMediaTrack(idLocal ?? "", "video");
  const audioLocal = useMediaTrack(idLocal ?? "", "audio");
  const dispositivos = useDevices();

  const [fase, setFase] = useState<Fase>("validando");
  const [mensagem, setMensagem] = useState<string>("");
  const [abreEm, setAbreEm] = useState<Date | null>(null);
  const [inicioConsulta, setInicioConsulta] = useState<Date | null>(null);

  // Estado dos dispositivos escolhido na pré-sala, levado para o join().
  const [semCamera, setSemCamera] = useState(false);
  const [micLigado, setMicLigado] = useState(true);
  const [camLigada, setCamLigada] = useState(true);
  const [avisoCamera, setAvisoCamera] = useState<string | null>(null);

  // O `camera-error` chega como evento, não como rejeição do `startCamera()` —
  // a Daily resolve a promessa mesmo com a permissão negada. Capturamos o último
  // evento num ref para classificar logo depois de `startCamera` retornar.
  const erroCamRef = useRef<DailyEventObjectCameraError | null>(null);
  useEffect(() => {
    if (!daily) return;
    const capturar = (ev: DailyEventObjectCameraError) => {
      erroCamRef.current = ev;
      console.error("[presala] camera-error", ev);
    };
    daily.on("camera-error", capturar);
    return () => {
      daily.off("camera-error", capturar);
    };
  }, [daily]);

  // ---- Etapa 0: checar a janela do link, SEM tocar em câmera nem rede --------
  // A separação "erro de credencial x erro de dispositivo" sai da leitura do
  // próprio token (nbf/exp), que é determinística e offline. NÃO chamamos
  // `preAuth` aqui: o objeto de chamada já nasce com url/token do DailyProvider,
  // e um `preAuth` por cima disso rejeitava para todo mundo e ainda arriscava
  // deixar o objeto num estado que quebrava o `startCamera`/`join` seguintes.
  // O que a janela do token não cobrir (sala removida), o `join()` no fim trata
  // com um erro de rede re-tentável.
  const validarCredencial = useCallback(() => {
    const { nbf, exp } = lerJanelaToken(token);
    const agora = Date.now();

    // O `EntradaSala` já barra o "cedo demais" antes de chegar aqui; esta
    // checagem cobre o caso raro de o horário virar com a pré-sala aberta.
    if (nbf && agora < nbf) {
      setAbreEm(new Date(nbf));
      setInicioConsulta(new Date(nbf + MIN_ANTES_MS));
      setMensagem("");
      setFase("credencial");
      return;
    }
    if (exp && agora > exp) {
      setMensagem("Esta consulta já foi encerrada.");
      setFase("credencial");
      return;
    }

    setFase("explicacao");
  }, [token]);

  // Roda uma vez na montagem (o StrictMode monta o efeito em dobro no dev).
  const jaValidou = useRef(false);
  useEffect(() => {
    if (jaValidou.current) return;
    jaValidou.current = true;
    validarCredencial();
  }, [validarCredencial]);

  // Chegou cedo: quando a janela abrir, recarrega — o `EntradaSala` reavalia a
  // credencial e remonta a pré-sala já liberada, sem F5 manual.
  useEffect(() => {
    if (fase !== "credencial" || !abreEm) return;
    const faltam = abreEm.getTime() - Date.now();
    if (faltam <= 0) return;
    const t = setTimeout(() => window.location.reload(), faltam + 1000);
    return () => clearTimeout(t);
  }, [fase, abreEm]);

  // ---- Etapa 1 → 2: pedir os dispositivos, dentro do gesto -------------------
  const permitir = useCallback(
    async (soAudio: boolean) => {
      if (!daily) return;
      setFase("preparando");
      setSemCamera(soAudio);
      setAvisoCamera(null);
      erroCamRef.current = null;

      try {
        await daily.startCamera({ startVideoOff: soAudio, startAudioOff: false });
      } catch (e) {
        // Não retorna: o evento camera-error abaixo é a fonte da verdade.
        console.error("[presala] startCamera rejeitou", e);
      }

      // Dá um instante para o camera-error (se houver) chegar antes de classificar.
      await new Promise((r) => setTimeout(r, 150));

      // Cast para o TS não achar que o ref continua `null` do reset acima: quem
      // o preenche é o handler de evento, invisível ao controle de fluxo.
      const ev = erroCamRef.current as DailyEventObjectCameraError | null;
      const tipo = ev?.error?.type;
      if (tipo) {
        // O microfone é indispensável; a câmera não — teleconsulta por áudio é
        // atendimento válido e já é tratada assim no resto do código.
        const microfoneAfetado =
          tipo === "permissions" || tipo === "mic-in-use" || tipo === "cam-mic-in-use";

        if (microfoneAfetado) {
          setMensagem(
            tipo === "permissions"
              ? mensagemPermissao()
              : "O microfone está sendo usado por outro programa ou aba. Feche o " +
                  "outro uso e toque em “Tentar de novo”.",
          );
          setFase("dispositivo");
          return;
        }

        // Só a câmera foi afetada: segue para o teste, mas já em modo áudio.
        setSemCamera(true);
        setCamLigada(false);
        setAvisoCamera(
          tipo === "not-found"
            ? "Nenhuma câmera foi encontrada neste aparelho — você entra por áudio."
            : "A câmera está indisponível agora — você entra por áudio. O atendimento funciona normalmente.",
        );
      }

      setMicLigado(true);
      setCamLigada(!soAudio && !ev);
      setFase("testando");
    },
    [daily],
  );

  const tentarDispositivosDeNovo = useCallback(() => {
    // Volta à explicação para um novo gesto de permissão (o iOS exige o toque).
    setFase("explicacao");
  }, []);

  const alternarMic = useCallback(() => {
    setMicLigado((v) => {
      const novo = !v;
      daily?.setLocalAudio(novo);
      return novo;
    });
  }, [daily]);

  const alternarCam = useCallback(() => {
    if (semCamera) return; // sem câmera disponível, não há o que alternar
    setCamLigada((v) => {
      const novo = !v;
      daily?.setLocalVideo(novo);
      return novo;
    });
  }, [daily, semCamera]);

  const entrarSoAudio = useCallback(() => {
    setSemCamera(true);
    setCamLigada(false);
    daily?.setLocalVideo(false);
  }, [daily]);

  // ------------------------------------------------------------------- telas

  if (fase === "validando") {
    return (
      <Painel>
        <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-2 border-slate-700 border-t-teal-400" />
        <p className="text-sm text-slate-300">Verificando o acesso à consulta…</p>
      </Painel>
    );
  }

  if (fase === "credencial") {
    // "cedo" (com contagem) vs. "encerrada"/"sala removida" (mensagem fixa).
    return (
      <Painel>
        {abreEm ? (
          <>
            <ContagemRegressiva ate={abreEm} />
            <h1 className="mt-5 font-serif text-xl text-white">
              A sala abre em instantes
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-slate-400">
              {inicioConsulta && (
                <>
                  Sua consulta é às{" "}
                  <strong className="text-slate-200">
                    {inicioConsulta.toLocaleTimeString("pt-BR", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </strong>
                  .{" "}
                </>
              )}
              A entrada libera 15 minutos antes — a página abre sozinha quando
              chegar a hora.
            </p>
          </>
        ) : (
          <>
            <div className="mx-auto mb-4 grid h-11 w-11 place-items-center rounded-full bg-slate-800 text-xl">
              🔒
            </div>
            <h1 className="font-serif text-xl text-white">Não foi possível entrar</h1>
            <p className="mt-2 text-sm leading-relaxed text-slate-400">{mensagem}</p>
            <ContatoWhatsApp />
          </>
        )}
      </Painel>
    );
  }

  if (fase === "explicacao") {
    const paciente = papel === "PACIENTE";
    return (
      <Painel largo>
        <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-full bg-teal-900/40 text-2xl">
          🎥
        </div>
        <h1 className="font-serif text-xl text-white">
          {paciente ? "Vamos preparar sua consulta" : "Preparar a sala"}
        </h1>
        <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-slate-300">
          {paciente ? (
            <>
              No próximo passo o navegador vai pedir permissão para usar sua{" "}
              <strong className="text-white">câmera e seu microfone</strong> — é o
              que permite você ver e conversar com a médica. Nada é gravado por esta
              autorização; ela só liga o vídeo e o som da chamada.
            </>
          ) : (
            <>
              O navegador vai pedir acesso à câmera e ao microfone para abrir a
              chamada. Autorize para testar os dispositivos antes de entrar.
            </>
          )}
        </p>

        <div className="mt-6 flex flex-col gap-2">
          <button
            onClick={() => void permitir(false)}
            className="rounded-xl bg-teal-700 px-6 py-3 text-sm font-semibold text-white hover:bg-teal-600"
          >
            Permitir câmera e microfone
          </button>
          {/* Áudio é atendimento válido — quem não tem/não quer câmera não pode
              ficar preso na porta. */}
          <button
            onClick={() => void permitir(true)}
            className="rounded-xl border border-slate-700 px-6 py-3 text-sm font-semibold text-slate-200 hover:bg-slate-800"
          >
            Entrar sem câmera (só áudio)
          </button>
        </div>
        <p className="mx-auto mt-4 max-w-md text-xs leading-relaxed text-slate-500">
          Só quando você tocar é que a permissão é pedida — no iPhone, pedir sem
          avisar faz o Safari negar por reflexo.
        </p>
      </Painel>
    );
  }

  if (fase === "preparando") {
    return (
      <Painel>
        <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-2 border-slate-700 border-t-teal-400" />
        <p className="text-sm text-slate-300">Acessando câmera e microfone…</p>
        <p className="mx-auto mt-2 max-w-xs text-xs leading-relaxed text-slate-500">
          Se aparecer um aviso do navegador pedindo permissão, toque em Permitir.
        </p>
      </Painel>
    );
  }

  if (fase === "dispositivo") {
    return (
      <Painel largo>
        <div className="mx-auto mb-4 grid h-11 w-11 place-items-center rounded-full bg-amber-900/40 text-xl">
          ⚠
        </div>
        <h1 className="font-serif text-xl text-white">
          Precisamos do microfone para começar
        </h1>
        <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-slate-300">
          {mensagem}
        </p>
        <div className="mt-6 flex flex-col gap-2">
          <button
            onClick={tentarDispositivosDeNovo}
            className="rounded-xl bg-teal-700 px-6 py-3 text-sm font-semibold text-white hover:bg-teal-600"
          >
            Tentar de novo
          </button>
        </div>
        <ContatoWhatsApp />
      </Painel>
    );
  }

  // ---- Etapa 2: teste de dispositivos ---------------------------------------
  return (
    <div className="grid min-h-dvh place-items-center bg-slate-950 px-4 py-8">
      <div className="w-full max-w-md">
        <h1 className="text-center font-serif text-xl text-white">
          Teste antes de entrar
        </h1>
        <p className="mx-auto mt-1 max-w-sm text-center text-xs leading-relaxed text-slate-400">
          Veja se você aparece e se o microfone está captando. É comum o celular
          pegar o microfone errado — dá para trocar aqui.
        </p>

        {/* Preview do próprio vídeo. `playsInline` impede o iOS de abrir em tela
            cheia; `muted` é o que permite o autoplay. */}
        <div className="relative mt-5 aspect-video overflow-hidden rounded-2xl border border-slate-800 bg-slate-900">
          {!semCamera && camLigada && videoLocal.persistentTrack ? (
            <PreviewVideo track={videoLocal.persistentTrack} />
          ) : (
            <div className="grid h-full place-items-center text-center">
              <div>
                <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-slate-800 text-xl">
                  {semCamera ? "🎧" : "📷"}
                </div>
                <p className="mt-2 text-xs text-slate-400">
                  {semCamera
                    ? "Entrando por áudio — sem vídeo."
                    : camLigada
                      ? "Iniciando a câmera…"
                      : "Câmera desligada."}
                </p>
              </div>
            </div>
          )}
        </div>

        {avisoCamera && (
          <p className="mt-2 rounded-lg bg-amber-900/30 px-3 py-2 text-xs leading-relaxed text-amber-200">
            {avisoCamera}
          </p>
        )}

        {/* Medidor de voz ao vivo. */}
        <MedidorMicrofone track={audioLocal.persistentTrack} micLigado={micLigado} />

        {/* Seletores de dispositivo. */}
        <div className="mt-4 space-y-2">
          {!semCamera && dispositivos.cameras.length > 0 && (
            <Seletor
              rotulo="Câmera"
              itens={dispositivos.cameras}
              atual={dispositivos.currentCam?.device.deviceId}
              aoTrocar={(id) => void dispositivos.setCamera(id)}
            />
          )}
          {dispositivos.microphones.length > 0 && (
            <Seletor
              rotulo="Microfone"
              itens={dispositivos.microphones}
              atual={dispositivos.currentMic?.device.deviceId}
              aoTrocar={(id) => void dispositivos.setMicrophone(id)}
            />
          )}
          {dispositivos.speakers.length > 0 && (
            <Seletor
              rotulo="Alto-falante"
              itens={dispositivos.speakers}
              atual={dispositivos.currentSpeaker?.device.deviceId}
              aoTrocar={(id) => void dispositivos.setSpeaker(id)}
            />
          )}
        </div>

        {/* Alternar câmera/microfone antes de entrar. */}
        <div className="mt-4 flex items-center justify-center gap-3">
          <BotaoAlternar ativo={micLigado} onClick={alternarMic} rotulo="Microfone">
            {micLigado ? "🎙 Microfone" : "🔇 Microfone"}
          </BotaoAlternar>
          {!semCamera && (
            <BotaoAlternar ativo={camLigada} onClick={alternarCam} rotulo="Câmera">
              {camLigada ? "📹 Câmera" : "🚫 Câmera"}
            </BotaoAlternar>
          )}
        </div>

        {erroEntrada && (
          <p className="mt-4 rounded-lg bg-red-900/40 px-3 py-2 text-center text-sm text-red-200">
            {erroEntrada}
          </p>
        )}

        {/* Etapa 3: só aqui roda o join(), dentro deste gesto. */}
        <button
          onClick={() => aoEntrar({ camLigada, micLigado })}
          disabled={entrando}
          className="mt-5 w-full rounded-xl bg-teal-700 px-6 py-3.5 text-sm font-semibold text-white hover:bg-teal-600 disabled:opacity-60"
        >
          {entrando ? "Entrando…" : "Entrar na consulta"}
        </button>

        {!semCamera && (
          <button
            onClick={entrarSoAudio}
            className="mt-2 w-full rounded-xl border border-slate-700 px-6 py-3 text-xs font-semibold text-slate-300 hover:bg-slate-800"
          >
            Entrar sem câmera (só áudio)
          </button>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------- auxiliares

function PreviewVideo({ track }: { track: MediaStreamTrack }) {
  const ref = useCallback(
    (el: HTMLVideoElement | null) => {
      if (el) el.srcObject = new MediaStream([track]);
    },
    [track],
  );
  return (
    <video
      ref={ref}
      autoPlay
      playsInline
      muted
      // Espelhado como um espelho: a pessoa se reconhece melhor.
      className="h-full w-full scale-x-[-1] object-cover"
    />
  );
}

/**
 * Medidor de nível do microfone. Usa o hook da própria Daily sobre a faixa bruta
 * (variante por track, que funciona antes do join) — ela cuida do AudioContext,
 * inclusive das restrições do Safari, melhor que um medidor caseiro.
 */
function MedidorMicrofone({
  track,
  micLigado,
}: {
  track: MediaStreamTrack | null | undefined;
  micLigado: boolean;
}) {
  const [nivel, setNivel] = useState(0);
  useAudioLevel(
    track ?? undefined,
    useCallback((volume: number) => setNivel(volume), []),
  );

  const barras = 12;
  const ativas = micLigado ? Math.round(Math.min(1, nivel * 1.6) * barras) : 0;

  return (
    <div className="mt-4 flex items-center gap-2">
      <span className="text-lg">{micLigado ? "🎙" : "🔇"}</span>
      <div className="flex flex-1 items-center gap-1" aria-hidden>
        {Array.from({ length: barras }).map((_, i) => (
          <div
            key={i}
            className={`h-3 flex-1 rounded-sm transition-colors ${
              i < ativas
                ? i > barras - 3
                  ? "bg-amber-400"
                  : "bg-teal-400"
                : "bg-slate-700"
            }`}
          />
        ))}
      </div>
      <span className="w-24 text-right text-xs text-slate-400">
        {micLigado ? "fale para testar" : "sem áudio"}
      </span>
    </div>
  );
}

function Seletor({
  rotulo,
  itens,
  atual,
  aoTrocar,
}: {
  rotulo: string;
  itens: { device: MediaDeviceInfo }[];
  atual: string | undefined;
  aoTrocar: (deviceId: string) => void;
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-slate-400">{rotulo}</span>
      <select
        value={atual ?? ""}
        onChange={(e) => aoTrocar(e.target.value)}
        className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100"
      >
        {itens.map((it, i) => (
          <option key={it.device.deviceId || i} value={it.device.deviceId}>
            {it.device.label || `${rotulo} ${i + 1}`}
          </option>
        ))}
      </select>
    </label>
  );
}

function BotaoAlternar({
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
      className={`rounded-full px-4 py-2 text-xs font-semibold transition ${
        ativo
          ? "bg-slate-700 text-white hover:bg-slate-600"
          : "bg-red-900/50 text-red-200 hover:bg-red-900/70"
      }`}
    >
      {children}
    </button>
  );
}

function Painel({
  children,
  largo = false,
}: {
  children: React.ReactNode;
  largo?: boolean;
}) {
  return (
    <div className="grid min-h-dvh place-items-center bg-slate-950 px-6">
      <div className={`text-center ${largo ? "max-w-lg" : "max-w-sm"}`}>{children}</div>
    </div>
  );
}

function ContatoWhatsApp() {
  return (
    <p className="mx-auto mt-6 max-w-sm border-t border-slate-800 pt-5 text-xs leading-relaxed text-slate-500">
      Se o problema continuar, fale pelo WhatsApp{" "}
      <a
        href="https://wa.me/5567991873948"
        target="_blank"
        rel="noopener"
        className="text-teal-400 underline underline-offset-2"
      >
        (67) 99187-3948
      </a>
      . Em urgência, procure o serviço de saúde mais próximo ou ligue 192.
    </p>
  );
}

function ContagemRegressiva({ ate }: { ate: Date }) {
  const [restante, setRestante] = useState(() => ate.getTime() - Date.now());
  useEffect(() => {
    const i = setInterval(() => setRestante(ate.getTime() - Date.now()), 1000);
    return () => clearInterval(i);
  }, [ate]);

  const total = Math.max(0, Math.floor(restante / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;

  return (
    <p className="font-mono text-3xl tabular-nums text-teal-300">
      {h > 0 && `${String(h).padStart(2, "0")}:`}
      {String(m).padStart(2, "0")}:{String(s).padStart(2, "0")}
    </p>
  );
}
