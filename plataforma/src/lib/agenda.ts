/**
 * Cálculo de horários livres.
 *
 * A regra de fuso horário que atravessa este arquivo inteiro:
 * **tudo é armazenado e comparado em UTC; o fuso só existe na fronteira.**
 *
 * Isso importa mais aqui do que numa agenda comum. A Dra. Laís atende em Mato
 * Grosso do Sul e em São Paulo — fusos diferentes — e por teleconsulta atende
 * paciente de qualquer lugar do país. "14:00" sem fuso é ambíguo em pelo menos
 * três sentidos. A disponibilidade recorrente é definida no fuso da médica
 * (`FUSO_MEDICA`), convertida para UTC ao gerar a grade, e reconvertida para o
 * fuso do paciente só na hora de exibir.
 */

import { addDays, addMinutes, startOfDay } from "date-fns";
import { fromZonedTime, toZonedTime, format } from "date-fns-tz";
import { ptBR } from "date-fns/locale";
import { prisma } from "@/lib/prisma";
import type { Modalidade } from "@prisma/client";

/** Fuso de referência da médica. MS não adota horário de verão. */
export const FUSO_MEDICA = "America/Campo_Grande";

/** Data no fuso da médica como "yyyy-MM-dd" — a chave que o calendário usa. */
export function chaveData(d: Date): string {
  return format(toZonedTime(d, FUSO_MEDICA), "yyyy-MM-dd", { timeZone: FUSO_MEDICA });
}

/** Marca das folgas criadas pelo dashboard (bloqueio de dia inteiro). */
export const MOTIVO_FOLGA = "Folga";

/** Antecedência mínima. Impede alguém marcar para daqui a 3 minutos. */
const ANTECEDENCIA_MINIMA_MIN = 120;

/** Janela máxima de agendamento futuro. */
export const HORIZONTE_DIAS = 60;

/**
 * Tolerância após o fim previsto da consulta antes de considerá-la abandonada.
 * Uma consulta fica `EM_ANDAMENTO` quando a médica entra na sala e só sai desse
 * estado ao assinar o registro — mas ela pode sair sem assinar (fechar a aba,
 * voltar à agenda, cair a conexão). Passada esta folga, o estado converge para
 * CONCLUIDA sozinho (cron) e a UI para de mostrar "em andamento".
 *
 * Fonte ÚNICA: usada tanto pela agenda (rótulo "não encerrada") quanto pelo cron
 * que encerra de fato — se divergirem, a UI e o banco discordam.
 */
export const FOLGA_ENCERRAMENTO_MIN = 30;

export interface Horario {
  /** Instante exato, em UTC. É isto que vai para o banco. */
  inicioEm: Date;
  duracaoMin: number;
  modalidade: Modalidade;
  /** Rótulo longo já no fuso de exibição, pronto para exibir. */
  rotulo: string;
  /**
   * Só a hora ("HH:mm") no fuso de exibição, pré-formatada no servidor. O
   * cliente exibe isto direto, sem reconverter pelo fuso do dispositivo — o que
   * garante que uma consulta PRESENCIAL mostre o horário DA CLÍNICA mesmo para
   * um paciente cujo celular está em outro fuso.
   */
  hora: string;
}

interface Intervalo {
  inicio: Date;
  fim: Date;
}

function sobrepoe(a: Intervalo, b: Intervalo) {
  // Encostar não é sobrepor: uma consulta que termina 14:30 não conflita com
  // outra que começa 14:30. Por isso `<` e `>`, não `<=` e `>=`.
  return a.inicio < b.fim && a.fim > b.inicio;
}

/**
 * Horários livres da médica num intervalo de datas.
 *
 * @param fusoPaciente fuso para os rótulos; o cálculo em si não depende dele.
 */
export async function horariosDisponiveis(opcoes: {
  medicaId: string;
  de: Date;
  ate: Date;
  modalidade?: Modalidade;
  fusoPaciente?: string;
}): Promise<Horario[]> {
  const { medicaId, modalidade, fusoPaciente = FUSO_MEDICA } = opcoes;

  const agora = new Date();
  const inicioJanela = new Date(
    Math.max(
      opcoes.de.getTime(),
      addMinutes(agora, ANTECEDENCIA_MINIMA_MIN).getTime(),
    ),
  );
  const fimJanela = new Date(
    Math.min(opcoes.ate.getTime(), addDays(agora, HORIZONTE_DIAS).getTime()),
  );

  if (inicioJanela >= fimJanela) return [];

  const [disponibilidades, datas, consultas, bloqueios] = await Promise.all([
    prisma.disponibilidade.findMany({
      where: { medicaId, ativo: true, ...(modalidade ? { modalidade } : {}) },
    }),
    // Horários especiais de datas específicas (dashboard). Substituem a janela
    // recorrente no dia em que existem — ver `janelasDoDia` abaixo.
    prisma.disponibilidadeData.findMany({
      where: {
        medicaId,
        ...(modalidade ? { modalidade } : {}),
        data: { gte: addDays(inicioJanela, -1), lte: addDays(fimJanela, 1) },
      },
    }),
    // Consultas canceladas e faltas liberam o horário de volta.
    prisma.consulta.findMany({
      where: {
        medicaId,
        inicioEm: { gte: addDays(inicioJanela, -1), lte: addDays(fimJanela, 1) },
        status: { notIn: ["CANCELADA", "FALTOU"] },
      },
      select: { inicioEm: true, duracaoMin: true },
    }),
    prisma.bloqueio.findMany({
      where: {
        medicaId,
        fimEm: { gte: inicioJanela },
        inicioEm: { lte: fimJanela },
      },
    }),
  ]);

  if (disponibilidades.length === 0 && datas.length === 0) return [];

  // Índice das datas com horário especial, por dia local "yyyy-MM-dd".
  const especiaisPorDia = new Map<string, typeof datas>();
  for (const d of datas) {
    const chave = format(toZonedTime(d.data, FUSO_MEDICA), "yyyy-MM-dd", {
      timeZone: FUSO_MEDICA,
    });
    (especiaisPorDia.get(chave) ?? especiaisPorDia.set(chave, []).get(chave)!).push(d);
  }

  const ocupados: Intervalo[] = [
    ...consultas.map((c) => ({
      inicio: c.inicioEm,
      fim: addMinutes(c.inicioEm, c.duracaoMin),
    })),
    ...bloqueios.map((b) => ({ inicio: b.inicioEm, fim: b.fimEm })),
  ];

  const horarios: Horario[] = [];

  // Percorre dia a dia no fuso da MÉDICA — é lá que "terça-feira" e "14:00"
  // fazem sentido. Iterar em UTC produziria a janela no dia errado perto da
  // meia-noite.
  let diaLocal = startOfDay(toZonedTime(inicioJanela, FUSO_MEDICA));
  const ultimoDiaLocal = startOfDay(toZonedTime(fimJanela, FUSO_MEDICA));

  while (diaLocal <= ultimoDiaLocal) {
    // Um horário especial substitui a janela recorrente daquele dia SÓ na MESMA
    // modalidade. Sem isto, um especial de teleconsulta apagava também as vagas
    // presenciais recorrentes do dia — que sumiam ou reapareciam conforme o
    // paciente tivesse filtrado por modalidade, porque a query de `datas` é
    // filtrada mas a substituição não era.
    const chaveDia = format(diaLocal, "yyyy-MM-dd");
    const especiais = especiaisPorDia.get(chaveDia) ?? [];
    const modalidadesComEspecial = new Set(especiais.map((e) => e.modalidade));
    const recorrentesDoDia = disponibilidades.filter(
      (d) => d.diaSemana === diaLocal.getDay() && !modalidadesComEspecial.has(d.modalidade),
    );
    const janelasDoDia = [...especiais, ...recorrentesDoDia];

    for (const disp of janelasDoDia) {
      const passo = disp.duracaoMin + disp.intervaloMin;

      for (let min = disp.inicioMin; min + disp.duracaoMin <= disp.fimMin; min += passo) {
        // Monta o instante local e converte para UTC. `fromZonedTime` resolve
        // corretamente as bordas de horário de verão de fusos que o adotam.
        const inicioLocal = addMinutes(diaLocal, min);
        const inicioEm = fromZonedTime(inicioLocal, FUSO_MEDICA);
        const fimEm = addMinutes(inicioEm, disp.duracaoMin);

        if (inicioEm < inicioJanela || inicioEm > fimJanela) continue;
        if (ocupados.some((o) => sobrepoe({ inicio: inicioEm, fim: fimEm }, o))) continue;

        horarios.push({
          inicioEm,
          duracaoMin: disp.duracaoMin,
          modalidade: disp.modalidade,
          rotulo: format(
            toZonedTime(inicioEm, fusoPaciente),
            "EEEE, d 'de' MMMM 'às' HH:mm",
            { locale: ptBR, timeZone: fusoPaciente },
          ),
          hora: format(toZonedTime(inicioEm, fusoPaciente), "HH:mm", {
            timeZone: fusoPaciente,
          }),
        });
      }
    }

    diaLocal = addDays(diaLocal, 1);
  }

  return horarios.sort((a, b) => a.inicioEm.getTime() - b.inicioEm.getTime());
}

/** Agrupa por dia para renderizar a grade. */
export function agruparPorDia(horarios: Horario[], fuso = FUSO_MEDICA) {
  const mapa = new Map<string, Horario[]>();
  for (const h of horarios) {
    const chave = format(toZonedTime(h.inicioEm, fuso), "yyyy-MM-dd", { timeZone: fuso });
    (mapa.get(chave) ?? mapa.set(chave, []).get(chave)!).push(h);
  }
  return [...mapa.entries()].map(([data, itens]) => ({ data, horarios: itens }));
}

/**
 * Revalida um horário no instante do agendamento.
 *
 * Necessária porque a lista de horários que o paciente vê pode ter minutos de
 * idade. Não substitui a constraint de unicidade no banco — cobre o caso do
 * horário que saiu da grade por outro motivo (bloqueio novo, janela desativada).
 */
export async function horarioAindaValido(
  medicaId: string,
  inicioEm: Date,
  modalidade: Modalidade,
): Promise<boolean> {
  const disponiveis = await horariosDisponiveis({
    medicaId,
    de: addMinutes(inicioEm, -1),
    ate: addMinutes(inicioEm, 1),
    modalidade,
  });
  return disponiveis.some((h) => h.inicioEm.getTime() === inicioEm.getTime());
}
