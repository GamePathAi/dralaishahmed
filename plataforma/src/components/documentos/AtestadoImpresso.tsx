/**
 * Corpo A4 do atestado — fonte ÚNICA do layout impresso (médica e paciente).
 * Ver `ReceitaImpressa` para o porquê de o layout morar num só lugar.
 */

import { toZonedTime, format } from "date-fns-tz";
import { ptBR } from "date-fns/locale";
import { env } from "@/lib/env";
import { FUSO_MEDICA } from "@/lib/agenda";
import { BotaoImprimir } from "@/components/prontuario/BotaoImprimir";
import { ROTULO_TIPO, type TipoAtestado } from "@/lib/documentos/modelos-atestado";

const soData = (d: Date) =>
  format(toZonedTime(d, FUSO_MEDICA), "dd/MM/yyyy", { locale: ptBR, timeZone: FUSO_MEDICA });
const dataHora = (d: Date) =>
  format(toZonedTime(d, FUSO_MEDICA), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR, timeZone: FUSO_MEDICA });

interface Props {
  atestado: {
    textoLivre: string;
    tipo: string;
    diasAfastamento: number | null;
    dataInicio: Date;
    cid: string | null;
    assinadaEm: Date | null;
    assinadaPor: string | null;
    versao: number;
  };
  paciente: { nome: string; cpf: string | null };
  voltarHref: string;
}

export function AtestadoImpresso({ atestado, paciente, voltarHref }: Props) {
  return (
    <>
      <style>{`
        @page { size: A4; margin: 20mm 18mm; }
        @media print { .no-print { display: none !important; } }
        .doc { color: #111; }
      `}</style>

      <BotaoImprimir voltarHref={voltarHref} />

      <main className="doc mx-auto max-w-3xl bg-white px-6 py-8 font-serif text-[15px] leading-relaxed">
        <header className="border-b-2 border-slate-800 pb-4 text-center">
          <h1 className="text-xl font-bold">{env.NOME_MEDICA}</h1>
          <p className="text-sm">{env.CRM_MEDICA} · Medicina</p>
          {env.ENDERECO_MEDICA ? (
            <p className="mt-1 text-xs">{env.ENDERECO_MEDICA}</p>
          ) : (
            <p className="no-print mt-1 text-xs italic text-amber-700">
              Endereço profissional não configurado (ENDERECO_MEDICA).
            </p>
          )}
          <p className="mt-3 text-lg font-semibold">Atestado Médico</p>
        </header>

        <section className="mt-5 text-sm">
          <p>
            <strong>Paciente:</strong> {paciente.nome}
            {paciente.cpf && <> · CPF {paciente.cpf}</>}
          </p>
        </section>

        <section className="mt-6 whitespace-pre-line text-justify">{atestado.textoLivre}</section>

        <section className="mt-4 text-sm">
          <p>
            <strong>Tipo:</strong> {ROTULO_TIPO[atestado.tipo as TipoAtestado]}
            {atestado.diasAfastamento ? ` · ${atestado.diasAfastamento} dia(s)` : ""}
            {` · a partir de ${soData(atestado.dataInicio)}`}
          </p>
          {atestado.cid && (
            <p className="mt-1">
              <strong>CID:</strong> {atestado.cid}{" "}
              <span className="text-xs text-slate-500">(informado com consentimento do paciente)</span>
            </p>
          )}
        </section>

        <section className="mt-10 text-sm">
          <p>
            {atestado.assinadaEm ? `Emitido em ${dataHora(atestado.assinadaEm)}` : `Emitido em ${dataHora(new Date())}`}
            {atestado.versao > 1 && ` · versão ${atestado.versao}`}
          </p>
          <div className="mt-10 text-center">
            <div className="mx-auto w-64 border-t border-slate-800 pt-1">
              <p className="text-sm font-semibold">{env.NOME_MEDICA}</p>
              <p className="text-xs">{atestado.assinadaPor ?? env.CRM_MEDICA}</p>
            </div>
          </div>
        </section>

        <footer className="mt-8 border-t border-slate-300 pt-4 text-xs text-slate-500">
          <p>
            Documento gerado a partir do prontuário eletrônico. A assinatura digital com validade
            jurídica (ICP-Brasil) é tratada na Fase 2.
          </p>
        </footer>
      </main>
    </>
  );
}
