/**
 * Corpo A4 da solicitação de exames — fonte ÚNICA do layout impresso (médica e
 * paciente). Ver `ReceitaImpressa` para o porquê.
 */

import { toZonedTime, format } from "date-fns-tz";
import { ptBR } from "date-fns/locale";
import { env } from "@/lib/env";
import { FUSO_MEDICA } from "@/lib/agenda";
import { BotaoImprimir } from "@/components/prontuario/BotaoImprimir";
import {
  ROTULO_CATEGORIA_EXAME,
  type CategoriaExame,
  type ItemExame,
} from "@/lib/documentos/exames-comuns";

const dataHora = (d: Date) =>
  format(toZonedTime(d, FUSO_MEDICA), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR, timeZone: FUSO_MEDICA });

const CATEGORIAS: CategoriaExame[] = ["SANGUE", "IMAGEM", "OUTROS"];

interface Props {
  solicitacao: {
    itens: ItemExame[];
    indicacaoClinica: string | null;
    assinadaEm: Date | null;
    assinadaPor: string | null;
    versao: number;
  };
  paciente: { nome: string; cpf: string | null };
  voltarHref: string;
}

export function ExamesImpresso({ solicitacao, paciente, voltarHref }: Props) {
  const itens = solicitacao.itens ?? [];

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
          <p className="mt-3 text-lg font-semibold">Solicitação de Exames</p>
        </header>

        <section className="mt-5 text-sm">
          <p>
            <strong>Paciente:</strong> {paciente.nome}
            {paciente.cpf && <> · CPF {paciente.cpf}</>}
          </p>
        </section>

        <section className="mt-6 space-y-4">
          {CATEGORIAS.map((cat) => {
            const doGrupo = itens.filter((i) => i.categoria === cat);
            if (doGrupo.length === 0) return null;
            return (
              <div key={cat}>
                <p className="text-sm font-semibold">{ROTULO_CATEGORIA_EXAME[cat]}</p>
                <ul className="mt-1 list-disc pl-6 text-sm">
                  {doGrupo.map((i, idx) => (
                    <li key={idx}>{i.nome}</li>
                  ))}
                </ul>
              </div>
            );
          })}
        </section>

        {solicitacao.indicacaoClinica && (
          <section className="mt-5 text-sm">
            <p className="font-semibold">Indicação clínica</p>
            <p className="mt-0.5 whitespace-pre-line">{solicitacao.indicacaoClinica}</p>
          </section>
        )}

        <section className="mt-10 text-sm">
          <p>
            {solicitacao.assinadaEm ? `Emitida em ${dataHora(solicitacao.assinadaEm)}` : `Emitida em ${dataHora(new Date())}`}
            {solicitacao.versao > 1 && ` · versão ${solicitacao.versao}`}
          </p>
          <div className="mt-10 text-center">
            <div className="mx-auto w-64 border-t border-slate-800 pt-1">
              <p className="text-sm font-semibold">{env.NOME_MEDICA}</p>
              <p className="text-xs">{solicitacao.assinadaPor ?? env.CRM_MEDICA}</p>
            </div>
          </div>
        </section>

        <footer className="mt-8 border-t border-slate-300 pt-4 text-xs text-slate-500">
          <p>Documento gerado a partir do prontuário eletrônico.</p>
        </footer>
      </main>
    </>
  );
}
