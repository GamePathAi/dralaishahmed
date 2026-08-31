"use client";

/**
 * Captura o áudio da consulta em segundo plano, sem interferir na videochamada.
 *
 * O ponto não óbvio: é preciso gravar as DUAS vozes. O microfone local só tem a
 * médica; o áudio remoto do paciente chega pela WebRTC em outra stream. A solução
 * é um AudioContext que mixa as duas fontes num único destino, e o MediaRecorder
 * grava esse destino. Gravar só o microfone produziria uma transcrição em que o
 * paciente nunca fala — inútil para prontuário.
 *
 * O hook se recusa a iniciar sem `consentimentoAceito`. É a segunda das duas
 * barreiras (a outra é no servidor, em /api/consultas/[id]/notas).
 */

import { useCallback, useEffect, useRef, useState } from "react";

export type EstadoGravacao = "ocioso" | "gravando" | "finalizando" | "erro";

interface Opcoes {
  consultaId: string;
  consentimentoAceito: boolean;
  /** Stream do microfone da médica. */
  streamLocal: MediaStream | null;
  /** Stream de áudio do paciente, vinda da videochamada. */
  streamRemota: MediaStream | null;
}

export function useGravadorConsulta({
  consultaId,
  consentimentoAceito,
  streamLocal,
  streamRemota,
}: Opcoes) {
  const [estado, setEstado] = useState<EstadoGravacao>("ocioso");
  const [duracaoSeg, setDuracaoSeg] = useState(0);
  const [erro, setErro] = useState<string | null>(null);
  /** Volume instantâneo (0–1) da mixagem. É a prova visual de captura. */
  const [nivel, setNivel] = useState(0);
  /** Bytes já gravados. Se fica em zero, o áudio está mudo de verdade. */
  const [bytes, setBytes] = useState(0);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const pedacosRef = useRef<Blob[]>([]);
  const contextoRef = useRef<AudioContext | null>(null);
  const cronometroRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const medidorRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const limpar = useCallback(() => {
    if (cronometroRef.current) {
      clearInterval(cronometroRef.current);
      cronometroRef.current = null;
    }
    if (medidorRef.current) {
      clearInterval(medidorRef.current);
      medidorRef.current = null;
    }
    setNivel(0);
    contextoRef.current?.close().catch(() => {});
    contextoRef.current = null;
    recorderRef.current = null;
  }, []);

  const iniciar = useCallback(() => {
    if (!consentimentoAceito) {
      setErro("Gravação bloqueada: o paciente não autorizou.");
      setEstado("erro");
      return;
    }
    if (!streamLocal) {
      setErro("Microfone indisponível.");
      setEstado("erro");
      return;
    }
    if (recorderRef.current) return; // já gravando

    try {
      const contexto = new AudioContext();
      // O navegador pode entregar o contexto suspenso quando não houve gesto
      // recente. Suspenso, ele não puxa amostra nenhuma e a gravação sai muda.
      void contexto.resume().catch(() => {});

      const destino = contexto.createMediaStreamDestination();

      // Medidor de volume: o mesmo sinal que vai para o gravador passa por um
      // analisador. É o que permite a médica VER que há captura, em vez de
      // confiar num rótulo. Áudio mudo é indistinguível de gravação quebrada
      // até a consulta acabar — e aí não dá mais para refazer.
      const analisador = contexto.createAnalyser();
      analisador.fftSize = 512;

      // Mixa médica + paciente numa única faixa.
      const fonteLocal = contexto.createMediaStreamSource(streamLocal);
      fonteLocal.connect(destino);
      fonteLocal.connect(analisador);

      if (streamRemota && streamRemota.getAudioTracks().length > 0) {
        const fonteRemota = contexto.createMediaStreamSource(streamRemota);
        fonteRemota.connect(destino);
        fonteRemota.connect(analisador);
      }

      const amostras = new Uint8Array(analisador.fftSize);
      medidorRef.current = setInterval(() => {
        analisador.getByteTimeDomainData(amostras);
        // RMS em torno de 128, que é o silêncio em PCM de 8 bits sem sinal.
        let soma = 0;
        for (const v of amostras) {
          const d = (v - 128) / 128;
          soma += d * d;
        }
        setNivel(Math.min(1, Math.sqrt(soma / amostras.length) * 4));
      }, 100);

      const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm";

      const recorder = new MediaRecorder(destino.stream, {
        mimeType: mime,
        audioBitsPerSecond: 64_000, // suficiente para voz; mantém o upload leve
      });

      pedacosRef.current = [];
      setBytes(0);
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          pedacosRef.current.push(e.data);
          setBytes((b) => b + e.data.size);
        }
      };
      recorder.onerror = () => {
        setErro("Falha na gravação.");
        setEstado("erro");
      };

      // Fatias de 10s: se o navegador cair no meio, o que já foi capturado
      // permanece nos pedaços em memória.
      recorder.start(10_000);

      contextoRef.current = contexto;
      recorderRef.current = recorder;
      setEstado("gravando");
      setDuracaoSeg(0);
      setErro(null);

      cronometroRef.current = setInterval(() => setDuracaoSeg((d) => d + 1), 1000);
    } catch {
      setErro("Não foi possível iniciar a gravação.");
      setEstado("erro");
    }
  }, [consentimentoAceito, streamLocal, streamRemota]);

  /** Encerra a gravação e devolve o áudio. `null` se não havia gravação. */
  const encerrar = useCallback((): Promise<Blob | null> => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") {
      limpar();
      setEstado("ocioso");
      return Promise.resolve(null);
    }

    setEstado("finalizando");

    return new Promise((resolve) => {
      recorder.onstop = () => {
        const blob = new Blob(pedacosRef.current, { type: recorder.mimeType });
        pedacosRef.current = [];
        limpar();
        setEstado("ocioso");
        resolve(blob.size > 0 ? blob : null);
      };
      recorder.stop();
    });
  }, [limpar]);

  /** Descarta a gravação sem produzir arquivo — usado se o paciente revoga o aceite. */
  const descartar = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.onstop = null;
      recorder.stop();
    }
    pedacosRef.current = [];
    limpar();
    setEstado("ocioso");
    setDuracaoSeg(0);
  }, [limpar]);

  // Se o consentimento for revogado durante a consulta, para na hora.
  useEffect(() => {
    if (!consentimentoAceito && estado === "gravando") descartar();
  }, [consentimentoAceito, estado, descartar]);

  useEffect(() => () => descartar(), [descartar]);

  return {
    estado,
    duracaoSeg,
    erro,
    nivel,
    bytes,
    iniciar,
    encerrar,
    descartar,
    consultaId,
  };
}
