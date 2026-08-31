/**
 * Salas de teleconsulta (Daily.co).
 *
 * Duas decisões que valem explicar, porque parecem restrições arbitrárias e são
 * escolhas deliberadas de privacidade:
 *
 * 1. **A gravação em nuvem da Daily fica DESLIGADA** (`enable_recording: false`),
 *    tanto na sala quanto no token. A gravação do sistema é local — MediaRecorder
 *    no navegador da médica, áudio para o nosso S3, apagado após transcrever.
 *    Ligar a gravação da Daily colocaria o VÍDEO da consulta na infraestrutura
 *    deles: outro operador, outra transferência internacional, outro contrato,
 *    e um acervo de vídeo de paciente que ninguém pediu. Se alguém precisar
 *    reativar isso um dia, é decisão jurídica antes de ser técnica.
 *
 * 2. **Sala privada com no máximo 2 participantes.** Link vazado não basta para
 *    entrar: é preciso um token assinado, emitido pelo servidor a quem está na
 *    consulta. O limite de 2 impede que um terceiro entre numa consulta em
 *    andamento mesmo com token válido de outra sessão.
 */

import { env } from "@/lib/env";
import type { Modalidade } from "@prisma/client";

const API = "https://api.daily.co/v1";

/** Antecedência com que os dois lados podem entrar (sala de espera). */
const MIN_ANTES = 15;
/** Folga após o horário previsto — consulta que estende não cai no meio. */
const MIN_DEPOIS = 30;

interface RespostaSala {
  name: string;
  url: string;
  config?: { exp?: number };
}

/** Erro da API da Daily, com o status preservado para decidir o que fazer. */
export class DailyError extends Error {
  constructor(
    readonly status: number,
    readonly corpo: string,
    caminho: string,
  ) {
    super(`Daily ${status} em ${caminho}: ${corpo.slice(0, 300)}`);
    this.name = "DailyError";
  }

  /** A sala já existe — outra requisição criou primeiro. */
  get salaJaExiste() {
    return this.status === 400 && /already exists|already in use/i.test(this.corpo);
  }
}

async function chamar<T>(
  caminho: string,
  init: RequestInit & { metodo?: string } = {},
): Promise<T> {
  const resposta = await fetch(`${API}${caminho}`, {
    ...init,
    method: init.metodo ?? init.method ?? "GET",
    headers: {
      Authorization: `Bearer ${env.DAILY_API_KEY}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
    cache: "no-store",
  });

  if (!resposta.ok) {
    const corpo = await resposta.text().catch(() => "");
    throw new DailyError(resposta.status, corpo, caminho);
  }
  return resposta.json() as Promise<T>;
}

/** Epoch em segundos — formato que a Daily espera em `exp` e `nbf`. */
const emSegundos = (data: Date) => Math.floor(data.getTime() / 1000);

function nomeDaSala(consultaId: string) {
  // Prefixo legível ajuda a identificar salas órfãs no painel da Daily.
  return `consulta-${consultaId}`;
}

// ---------------------------------------------------------------- salas

export interface SalaCriada {
  salaNome: string;
  salaUrl: string;
  salaExpiraEm: Date;
}

/**
 * Cria (ou reaproveita) a sala de uma consulta.
 *
 * Idempotente de propósito: a médica e o paciente podem abrir a sala em
 * qualquer ordem, e um refresh de página não pode gerar uma segunda sala —
 * eles acabariam em salas diferentes, cada um esperando o outro aparecer.
 */
export async function garantirSalaConsulta(opcoes: {
  consultaId: string;
  inicioEm: Date;
  duracaoMin: number;
  /** Acompanhante, intérprete de Libras ou responsável de menor. */
  participantesExtras?: number;
}): Promise<SalaCriada> {
  const { consultaId, inicioEm, duracaoMin, participantesExtras = 0 } = opcoes;

  const salaNome = nomeDaSala(consultaId);
  const expiraEm = new Date(
    inicioEm.getTime() + (duracaoMin + MIN_DEPOIS) * 60_000,
  );

  const existente = await chamar<RespostaSala>(`/rooms/${salaNome}`).catch(
    () => null,
  );

  if (existente) {
    const jaExpirou =
      existente.config?.exp !== undefined &&
      existente.config.exp * 1000 < Date.now();

    if (!jaExpirou) {
      return {
        salaNome: existente.name,
        salaUrl: existente.url,
        salaExpiraEm: existente.config?.exp
          ? new Date(existente.config.exp * 1000)
          : expiraEm,
      };
    }

    // Sala vencida (consulta remarcada, por exemplo): apaga e recria com a
    // nova janela em vez de tentar atualizar uma sala já encerrada.
    await chamar(`/rooms/${salaNome}`, { metodo: "DELETE" }).catch(() => {});
  }

  const corpoDaSala = JSON.stringify({
    name: salaNome,
    privacy: "private", // só entra quem tem token assinado
    properties: {
      exp: emSegundos(expiraEm),
      nbf: emSegundos(new Date(inicioEm.getTime() - MIN_ANTES * 60_000)),
      eject_at_room_exp: true,

      // Médica + paciente. Extras só quando há motivo declarado.
      max_participants: 2 + participantesExtras,

      // NÃO se define `enable_prejoin_ui` aqui: essa propriedade só tem efeito no
      // Daily Prebuilt (o iframe pronto da Daily). Este projeto usa `daily-react`
      // com interface própria, então o campo seria inerte e sugeriria uma pré-sala
      // que a Daily não renderiza. A pré-sala real é a nossa `PreSala.tsx` — é lá
      // que a pessoa autoriza câmera/microfone (dentro de um gesto, exigência do
      // Safari no iOS) e testa os dispositivos antes de o `join()` acontecer.

      // Gravação em nuvem desligada — ver a nota no topo do arquivo.
      //
      // String vazia, não `false`: na Daily este campo é enum de string
      // ("cloud" | "local" | "raw-tracks"), e "" é a forma documentada de
      // dizer "nenhuma". Um booleano até funciona hoje, por coerção, mas numa
      // trava de privacidade não se aposta em conversão implícita de tipo.
      //
      // Também não basta omitir o campo: omitido, a sala herdaria a
      // configuração padrão do domínio — que alguém pode ligar no painel sem
      // saber que existe código contando com isso.
      enable_recording: "",

      enable_chat: true,        // útil para enviar nome de medicação por escrito
      enable_screenshare: true, // paciente mostrar um exame, médica um material
      enable_knocking: false,   // desnecessário: a sala já é privada por token

      start_video_off: false,
      start_audio_off: false,
      lang: "pt",
    },
  });

  // Corrida real, não hipotética: médica e paciente abrem a consulta no mesmo
  // instante, ambos recebem 404 no GET acima e ambos tentam criar. O segundo
  // POST falha com "already exists" — e a resposta certa não é propagar o erro,
  // é buscar a sala que o primeiro acabou de criar. Sem isto, um dos dois vê
  // "não foi possível abrir a sala" justamente quando tudo deu certo.
  let sala: RespostaSala;
  try {
    sala = await chamar<RespostaSala>("/rooms", {
      metodo: "POST",
      body: corpoDaSala,
    });
  } catch (erro) {
    if (erro instanceof DailyError && erro.salaJaExiste) {
      sala = await chamar<RespostaSala>(`/rooms/${salaNome}`);
    } else {
      throw erro;
    }
  }

  return {
    salaNome: sala.name,
    salaUrl: sala.url,
    salaExpiraEm: sala.config?.exp ? new Date(sala.config.exp * 1000) : expiraEm,
  };
}

// ---------------------------------------------------------------- tokens

interface RespostaToken {
  token: string;
}

/**
 * Token de acesso individual à sala.
 *
 * O token carrega quem é a pessoa e até quando pode entrar. A janela `nbf`/`exp`
 * é o que impede um link de consulta antiga continuar funcionando semanas depois
 * — o vazamento de um link, sozinho, não dá acesso a nada.
 */
export async function gerarTokenAcesso(opcoes: {
  salaNome: string;
  usuarioId: string;
  nome: string;
  papel: "MEDICA" | "PACIENTE";
  inicioEm: Date;
  duracaoMin: number;
}): Promise<string> {
  const { salaNome, usuarioId, nome, papel, inicioEm, duracaoMin } = opcoes;

  const { token } = await chamar<RespostaToken>("/meeting-tokens", {
    metodo: "POST",
    body: JSON.stringify({
      properties: {
        room_name: salaNome,
        user_id: usuarioId,
        user_name: nome,

        // A médica é dona da sala: pode silenciar e remover participante — útil
        // se alguém entrar por engano ou a conexão do paciente duplicar.
        is_owner: papel === "MEDICA",

        nbf: emSegundos(new Date(inicioEm.getTime() - MIN_ANTES * 60_000)),
        exp: emSegundos(
          new Date(inicioEm.getTime() + (duracaoMin + MIN_DEPOIS) * 60_000),
        ),

        // Redundante com a configuração da sala, e é assim de propósito:
        // se alguém reativar a gravação na sala sem pensar, o token continua
        // negando. Duas trancas na mesma porta. (Chega no JWT como `er`.)
        enable_recording: "",
      },
    }),
  });

  return token;
}

// ------------------------------------------------------------- limpeza

/**
 * Remove a sala após a consulta.
 *
 * A sala expira sozinha por `exp`, mas apagar explicitamente ao encerrar mantém
 * o painel da Daily limpo e reduz a janela em que um token ainda válido poderia
 * ser reutilizado.
 */
export async function removerSala(salaNome: string): Promise<void> {
  await chamar(`/rooms/${salaNome}`, { metodo: "DELETE" }).catch((erro) => {
    // Falha aqui não pode derrubar o encerramento da consulta — a sala expira
    // sozinha de qualquer forma. Registra e segue.
    console.warn("[daily] não foi possível remover a sala", { salaNome, erro });
  });
}

/** Teleconsulta precisa de sala; presencial não. */
export function exigeSala(modalidade: Modalidade) {
  return modalidade === "TELECONSULTA";
}
