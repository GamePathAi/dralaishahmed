"use client";

/**
 * Agendamento em dois passos: escolher o horário, depois se identificar.
 *
 * A ordem importa. Pedir dados pessoais antes de mostrar se existe horário
 * disponível faz a pessoa preencher um formulário para descobrir que não há
 * vaga — e entrega dado pessoal de alguém que nem virou paciente.
 *
 * Os horários são exibidos no fuso do NAVEGADOR do paciente, não no da médica.
 * Alguém em Manaus vendo "14:00" precisa que sejam 14:00 para ele. O servidor
 * recebe de volta o instante em UTC, então não há ambiguidade na gravação.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { formatarBRL } from "@/lib/config-medica";
import { cpfValido } from "@/lib/cpf";

type Modalidade = "TELECONSULTA" | "PRESENCIAL";

/** Dados do Pix pendente enquanto o paciente paga para confirmar a consulta. */
interface PagamentoPendente {
  consultaId: string;
  copiaCola: string;
  qrBase64: string;
  /** ISO-8601. */
  expiraEm: string;
  valorCent: number;
  teste: boolean;
  rotulo: string;
  teleconsulta: boolean;
  /** Link de checkout (Pix/cartão/boleto), quando o provedor devolve. */
  linkPagamento?: string;
}

interface HorarioApi {
  inicioEm: string;
  duracaoMin: number;
  modalidade: Modalidade;
  rotulo: string;
  /** Hora "HH:mm" já no fuso de exibição, formatada pelo servidor. */
  hora: string;
}
interface DiaApi {
  data: string;
  horarios: HorarioApi[];
}

export function FormularioAgendamento({ exigeCpf = false }: { exigeCpf?: boolean }) {
  const fuso = useMemo(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone,
    [],
  );

  const [modalidade, setModalidade] = useState<Modalidade>("TELECONSULTA");
  const [dias, setDias] = useState<DiaApi[]>([]);
  // Os horários da grade estão no fuso da clínica (presencial) ou do paciente
  // (teleconsulta)? Só muda o rótulo que a gente mostra, não os dados.
  const [fusoDaClinica, setFusoDaClinica] = useState(false);
  const [carregando, setCarregando] = useState(true);
  // Falha ao CARREGAR a grade — distinta de "não há horário". Sem isto, um 429
  // ou 500 virava "nenhum horário disponível" e mandava embora o paciente que
  // tinha vaga (o pior bug possível no pico de tráfego pago).
  const [erroGrade, setErroGrade] = useState<string | null>(null);
  // Contador que força o efeito a recarregar — trocar modalidade para o mesmo
  // valor não dispara nada no React (bail-out), então "tentar de novo" precisa
  // de um estado que muda de verdade.
  const [recarregar, setRecarregar] = useState(0);
  const [escolhido, setEscolhido] = useState<HorarioApi | null>(null);
  // No celular, o passo 2 nasce abaixo da dobra: sem rolar até ele, o paciente
  // escolhe o horário e acha que acabou. Rolamos para o formulário na escolha.
  const passo2Ref = useRef<HTMLFormElement | null>(null);

  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  // Pix pendente: a consulta foi criada, mas só confirma quando o pagamento
  // cai. Enquanto isto não é null, mostramos a tela de pagamento.
  const [pagamento, setPagamento] = useState<PagamentoPendente | null>(null);
  const [concluido, setConcluido] = useState<{
    mensagem: string;
    confirmacaoEnviada: boolean;
    rotulo: string;
    teleconsulta: boolean;
    /** true quando a resposta foi neutra (guard) e nenhuma consulta foi criada. */
    semConsulta: boolean;
  } | null>(null);

  useEffect(() => {
    let ativo = true;
    setCarregando(true);
    setErroGrade(null);
    setEscolhido(null);

    (async () => {
      try {
        const r = await fetch(
          `/api/agenda/horarios?modalidade=${modalidade}&fuso=${encodeURIComponent(fuso)}`,
        );
        // Sem checar o status, o corpo de um 429/500 (que NÃO tem `dias`) virava
        // grade vazia e a tela dizia "nenhum horário" — expulsando quem tinha
        // vaga. Agora um erro de carga é um erro de carga, não ausência de vaga.
        if (!ativo) return;
        if (r.status === 429) {
          setErroGrade(
            "Muitos acessos agora. Aguarde alguns segundos e toque em recarregar.",
          );
          setDias([]);
          return;
        }
        if (!r.ok) {
          setErroGrade("Não foi possível carregar os horários. Tente novamente.");
          setDias([]);
          return;
        }
        const d = await r.json();
        if (ativo) {
          setDias(Array.isArray(d.dias) ? d.dias : []);
          setFusoDaClinica(d.fusoDaClinica === true);
        }
      } catch {
        if (ativo)
          setErroGrade(
            "Sem conexão para carregar os horários. Verifique a internet e tente novamente.",
          );
      } finally {
        if (ativo) setCarregando(false);
      }
    })();

    return () => {
      ativo = false;
    };
  }, [modalidade, fuso, recarregar]);

  // Ao escolher um horário, traz o passo 2 para a vista — decisivo no celular,
  // onde o formulário fica abaixo da dobra e passa despercebido.
  useEffect(() => {
    if (escolhido && passo2Ref.current) {
      passo2Ref.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [escolhido]);

  const enviar = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    // Guarda de reentrância: duplo-toque no mobile não dispara dois POST.
    if (!escolhido || enviando) return;

    setEnviando(true);
    setErro(null);

    const form = new FormData(e.currentTarget);

    // Validação de CPF no cliente evita o vai-e-volta com o servidor (e com o
    // provedor) por um dígito trocado.
    if (exigeCpf && !cpfValido(String(form.get("cpf") ?? ""))) {
      setErro("Informe um CPF válido para o pagamento.");
      setEnviando(false);
      return;
    }

    try {
      const resposta = await fetch("/api/consultas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nome: form.get("nome"),
          email: form.get("email"),
          telefone: form.get("telefone"),
          nascimento: form.get("nascimento") || undefined,
          cpf: form.get("cpf") || undefined,
          motivo: form.get("motivo") || undefined,
          inicioEm: escolhido.inicioEm,
          modalidade: escolhido.modalidade,
          duracaoMin: escolhido.duracaoMin,
          aceitouTermos: form.get("termos") === "on",
        }),
      });

      const dados = await resposta.json().catch(() => ({}));

      if (resposta.status === 429) {
        setErro(
          "Muitas tentativas em pouco tempo. Aguarde um instante e tente de novo.",
        );
        return;
      }

      if (!resposta.ok) {
        setErro(dados.erro ?? "Não foi possível agendar.");
        // Horário tomado no intervalo: recarrega a grade para não insistir nele.
        if (dados.codigo === "HORARIO_INDISPONIVEL") {
          setEscolhido(null);
          setRecarregar((n) => n + 1);
        }
        return;
      }

      // 202 = e-mail que não é de paciente (guard da médica): a resposta é
      // neutra e NÃO criou consulta. Não pode mostrar a tela verde de sucesso.
      if (resposta.status === 202 || !dados.consultaId) {
        setConcluido({
          mensagem:
            dados.mensagem ??
            "Recebemos seu pedido. Se houver uma conta com esse e-mail, você receberá a confirmação.",
          confirmacaoEnviada: true,
          rotulo: "",
          teleconsulta: escolhido.modalidade === "TELECONSULTA",
          semConsulta: true,
        });
        return;
      }

      // Caminho normal agora: a consulta nasce aguardando pagamento e a resposta
      // traz o Pix. A tela vira a de pagamento; a confirmação só aparece quando
      // o pagamento cai (webhook), detectado pelo polling.
      if (dados.pix) {
        setPagamento({
          consultaId: dados.consultaId,
          copiaCola: dados.pix.copiaCola,
          qrBase64: dados.pix.qrBase64,
          expiraEm: dados.pix.expiraEm,
          valorCent: dados.valorCent ?? 0,
          teste: dados.pix.teste === true,
          linkPagamento: dados.pix.linkPagamento,
          rotulo: escolhido.rotulo,
          teleconsulta: escolhido.modalidade === "TELECONSULTA",
        });
        return;
      }

      // Sem Pix (pagamento desligado ou consulta isenta): a consulta já foi
      // confirmada e o e-mail saiu nesta mesma resposta. Mostra a confirmação
      // honesta — inclusive o caso em que o e-mail falhou (tela âmbar).
      setConcluido({
        mensagem: dados.mensagem ?? "Consulta agendada.",
        confirmacaoEnviada: dados.confirmacaoEnviada !== false,
        rotulo: escolhido.rotulo,
        teleconsulta: escolhido.modalidade === "TELECONSULTA",
        semConsulta: false,
      });
    } catch {
      // Sem isto, uma falha de rede deixava o botão preso em "Agendando…" para
      // sempre, e o paciente sem saber se agendou.
      setErro(
        "Não foi possível concluir agora. Verifique a internet e tente novamente — " +
          "se o problema persistir, chame no WhatsApp.",
      );
    } finally {
      setEnviando(false);
    }
  };

  if (pagamento && !concluido) {
    return (
      <TelaPagamento
        pagamento={pagamento}
        aoPagar={() =>
          setConcluido({
            mensagem:
              "Pagamento confirmado. Sua consulta está agendada e você receberá a confirmação por e-mail.",
            confirmacaoEnviada: true,
            rotulo: pagamento.rotulo,
            teleconsulta: pagamento.teleconsulta,
            semConsulta: false,
          })
        }
        aoExpirar={() => {
          // A reserva caiu: o horário volta à grade. Devolve o paciente ao passo 1.
          setPagamento(null);
          setEscolhido(null);
          setErro(
            "O tempo para pagamento expirou e o horário foi liberado. Escolha um horário novamente.",
          );
          setRecarregar((n) => n + 1);
        }}
        aoCancelar={() => {
          setPagamento(null);
          setEscolhido(null);
          setRecarregar((n) => n + 1);
        }}
      />
    );
  }

  if (concluido) {
    const ok = concluido.confirmacaoEnviada;

    return (
      <div
        className={`rounded-2xl border p-8 text-center ${
          ok ? "border-teal-200 bg-teal-50" : "border-amber-300 bg-amber-50"
        }`}
      >
        <div
          className={`mx-auto mb-4 grid h-12 w-12 place-items-center rounded-full text-xl text-white ${
            ok ? "bg-teal-800" : "bg-amber-700"
          }`}
        >
          ✓
        </div>
        <h2
          className={`font-serif text-xl ${ok ? "text-teal-950" : "text-amber-950"}`}
        >
          {concluido.semConsulta ? "Pedido recebido" : "Consulta agendada"}
        </h2>

        {/* O horário aparece SEMPRE que houve agendamento — confirmar na tela o
            que a pessoa marcou é o retorno mínimo, e se o e-mail cai no spam,
            esta vira a única confirmação que ela viu. No caminho neutro (guard)
            não existe horário para mostrar. */}
        {concluido.rotulo && (
          <p
            className={`mx-auto mt-4 max-w-sm rounded-lg bg-white/70 px-4 py-3 font-semibold ${
              ok ? "text-teal-950" : "text-amber-950"
            }`}
          >
            {concluido.rotulo}
          </p>
        )}

        <p
          className={`mx-auto mt-3 max-w-sm text-sm leading-relaxed ${
            ok ? "text-teal-900" : "text-amber-900"
          }`}
        >
          {concluido.mensagem}
        </p>

        {ok && !concluido.semConsulta && (
          <p className="mx-auto mt-2 max-w-sm text-xs leading-relaxed text-teal-800">
            Não achou o e-mail? Confira o lixo eletrônico.
            {concluido.teleconsulta &&
              " O link de acesso à sala chega em uma mensagem separada, cerca de 15 minutos antes da consulta."}
          </p>
        )}

        {!ok && (
          <p className="mx-auto mt-2 max-w-sm text-xs leading-relaxed text-amber-800">
            Seu agendamento está confirmado mesmo assim — anote o horário acima.
            Se quiser conferir, fale com a secretaria pelo WhatsApp.
          </p>
        )}

        {/* Sem isto a tela é um beco sem saída: nem voltar ao site, nem marcar
            outro horário para um familiar. */}
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <a
            href="/"
            className={`rounded-lg px-4 py-2.5 text-sm font-semibold text-white ${
              ok ? "bg-teal-800 hover:bg-teal-900" : "bg-amber-700 hover:bg-amber-800"
            }`}
          >
            Voltar ao início
          </a>
          <button
            type="button"
            onClick={() => {
              setConcluido(null);
              setEscolhido(null);
              setErro(null);
              setRecarregar((n) => n + 1); // recarrega a grade sem o horário tomado
            }}
            className={`rounded-lg border px-4 py-2.5 text-sm font-semibold ${
              ok
                ? "border-teal-300 text-teal-900 hover:bg-teal-100"
                : "border-amber-300 text-amber-900 hover:bg-amber-100"
            }`}
          >
            Agendar outro horário
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* passo 1 — modalidade e horário */}
      <section>
        <h2 className="font-serif text-xl text-slate-900">
          1. Escolha o horário
        </h2>

        <div className="mt-4 inline-flex rounded-xl bg-slate-100 p-1">
          {(["TELECONSULTA", "PRESENCIAL"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setModalidade(m)}
              className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
                modalidade === m
                  ? "bg-white text-teal-900 shadow-sm"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              {m === "TELECONSULTA" ? "Teleconsulta" : "Presencial"}
            </button>
          ))}
        </div>

        <p className="mt-2 text-xs text-slate-500">
          {fusoDaClinica
            ? "Horários no fuso da clínica (onde a consulta acontece)."
            : `Horários no seu fuso (${fuso.replace("_", " ")}).`}
        </p>

        <div className="mt-5">
          {carregando ? (
            <div className="grid gap-2 sm:grid-cols-3">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="h-11 animate-pulse rounded-lg bg-slate-100" />
              ))}
            </div>
          ) : erroGrade ? (
            // Falha de carga NÃO é ausência de vaga. Mostrar o erro com um botão
            // de recarregar — nunca "nenhum horário", que manda embora quem tem vaga.
            <div className="rounded-xl bg-amber-50 px-4 py-6 text-center">
              <p className="text-sm text-amber-900">{erroGrade}</p>
              <button
                type="button"
                onClick={() => setRecarregar((n) => n + 1)}
                className="mt-3 rounded-lg bg-amber-700 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-800"
              >
                Recarregar horários
              </button>
            </div>
          ) : dias.length === 0 ? (
            <p className="rounded-xl bg-slate-50 px-4 py-6 text-center text-sm text-slate-600">
              Nenhum horário disponível nesta modalidade nos próximos dias.
              {modalidade === "PRESENCIAL" && " Considere a teleconsulta."}
            </p>
          ) : (
            <div className="max-h-80 space-y-5 overflow-y-auto pr-1">
              {dias.map((dia) => (
                <div key={dia.data}>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    {new Date(`${dia.data}T12:00:00`).toLocaleDateString("pt-BR", {
                      weekday: "long",
                      day: "numeric",
                      month: "long",
                    })}
                  </h3>
                  <div className="grid gap-2 sm:grid-cols-4">
                    {dia.horarios.map((h) => {
                      const ativo = escolhido?.inicioEm === h.inicioEm;
                      return (
                        <button
                          key={h.inicioEm}
                          type="button"
                          onClick={() => setEscolhido(h)}
                          aria-pressed={ativo}
                          className={`rounded-lg border px-3 py-2.5 text-sm font-medium transition ${
                            ativo
                              ? "border-teal-800 bg-teal-800 text-white"
                              : "border-slate-300 text-slate-700 hover:border-teal-700 hover:text-teal-800"
                          }`}
                        >
                          {h.hora}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* passo 2 — identificação, só depois do horário escolhido */}
      {escolhido && (
        <form
          ref={passo2Ref}
          onSubmit={enviar}
          className="scroll-mt-4 border-t border-slate-200 pt-8"
        >
          <h2 className="font-serif text-xl text-slate-900">
            2. Seus dados
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            {escolhido.rotulo} · {escolhido.duracaoMin} min ·{" "}
            {escolhido.modalidade === "TELECONSULTA" ? "Teleconsulta" : "Presencial"}
          </p>

          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <Campo nome="nome" rotulo="Nome completo" obrigatorio className="sm:col-span-2" />
            <Campo nome="email" rotulo="E-mail" tipo="email" obrigatorio />
            <Campo nome="telefone" rotulo="Telefone / WhatsApp" tipo="tel" obrigatorio />
            <Campo nome="nascimento" rotulo="Data de nascimento" tipo="date" />
            {exigeCpf && (
              <Campo nome="cpf" rotulo="CPF (para o pagamento via Pix)" obrigatorio />
            )}

            <div className="sm:col-span-2">
              <label htmlFor="motivo" className="text-sm font-medium text-slate-700">
                Motivo da consulta{" "}
                <span className="font-normal text-slate-400">(opcional)</span>
              </label>
              <textarea
                id="motivo"
                name="motivo"
                rows={3}
                maxLength={500}
                placeholder="Em poucas palavras, o que você gostaria de tratar."
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-700 focus:ring-1 focus:ring-teal-700"
              />
              <p className="mt-1 text-xs text-slate-500">
                Não escreva histórico clínico detalhado aqui — isso é conversado na
                consulta, em ambiente protegido por sigilo médico.
              </p>
            </div>
          </div>

          <label className="mt-5 flex items-start gap-2.5 text-sm text-slate-700">
            <input
              type="checkbox"
              name="termos"
              required
              className="mt-0.5 h-4 w-4 rounded border-slate-400 text-teal-800"
            />
            {/* Documentos vivem no site institucional — não são duplicados aqui.
                Manter duas versões de texto sujeito às regras do CFM sobre
                publicidade médica é criar divergência com o tempo. */}
            <span>
              Li e aceito os{" "}
              <a
                href="https://www.dralaishahmed.com.br/termos-de-uso.html"
                target="_blank"
                rel="noopener"
                className="text-teal-800 underline underline-offset-2"
              >
                Termos de Uso
              </a>{" "}
              e a{" "}
              <a
                href="https://www.dralaishahmed.com.br/politica-de-privacidade.html"
                target="_blank"
                rel="noopener"
                className="text-teal-800 underline underline-offset-2"
              >
                Política de Privacidade
              </a>
              .
            </span>
          </label>

          {erro && (
            <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
              {erro}
            </p>
          )}

          <button
            type="submit"
            disabled={enviando}
            className="mt-6 w-full rounded-xl bg-teal-800 px-6 py-3.5 text-sm font-semibold text-white hover:bg-teal-900 disabled:opacity-50 sm:w-auto"
          >
            {enviando ? "Agendando…" : "Confirmar agendamento"}
          </button>
        </form>
      )}
    </div>
  );
}

function TelaPagamento({
  pagamento,
  aoPagar,
  aoExpirar,
  aoCancelar,
}: {
  pagamento: PagamentoPendente;
  aoPagar: () => void;
  aoExpirar: () => void;
  aoCancelar: () => void;
}) {
  const alvo = useMemo(
    () => new Date(pagamento.expiraEm).getTime(),
    [pagamento.expiraEm],
  );
  const [restanteSeg, setRestanteSeg] = useState(() =>
    Math.max(0, Math.floor((alvo - Date.now()) / 1000)),
  );
  const [copiado, setCopiado] = useState(false);
  const [pagandoTeste, setPagandoTeste] = useState(false);
  const [erroTeste, setErroTeste] = useState<string | null>(null);

  // Contagem regressiva até o fim da janela de reserva.
  useEffect(() => {
    const t = setInterval(() => {
      const s = Math.max(0, Math.floor((alvo - Date.now()) / 1000));
      setRestanteSeg(s);
      if (s <= 0) {
        clearInterval(t);
        aoExpirar();
      }
    }, 1000);
    return () => clearInterval(t);
  }, [alvo, aoExpirar]);

  // Polling leve do status: o pagamento é confirmado pelo servidor (webhook),
  // nunca pelo cliente. Aqui só perguntamos "já caiu?".
  useEffect(() => {
    let ativo = true;
    let timer: ReturnType<typeof setTimeout>;

    const checar = async () => {
      try {
        const r = await fetch(`/api/consultas/${pagamento.consultaId}/pagamento`);
        if (!ativo) return;
        if (r.status === 404) {
          // A reserva foi removida pelo cron: expirou.
          aoExpirar();
          return;
        }
        if (r.ok) {
          const d = await r.json();
          // Olha também `pagamento.status`: a projeção `statusPagamento` na
          // consulta é atualizada junto com a confirmação, mas checar a fonte
          // (o pagamento) evita dizer "expirou" a quem já pagou caso a projeção
          // fique para trás.
          if (
            d.statusPagamento === "PAGO" ||
            d.status === "CONFIRMADA" ||
            d.pagamento?.status === "PAGO"
          ) {
            aoPagar();
            return;
          }
          if (d.statusPagamento === "EXPIRADO" || d.pagamento?.status === "EXPIRADO") {
            aoExpirar();
            return;
          }
        }
      } catch {
        /* rede instável: tenta na próxima volta */
      }
      if (ativo) timer = setTimeout(checar, 3000);
    };

    timer = setTimeout(checar, 3000);
    return () => {
      ativo = false;
      clearTimeout(timer);
    };
  }, [pagamento.consultaId, aoPagar, aoExpirar]);

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(pagamento.copiaCola);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      /* clipboard indisponível (http, permissão) — o campo segue selecionável */
    }
  };

  const pagarTeste = async () => {
    setPagandoTeste(true);
    setErroTeste(null);
    try {
      const r = await fetch("/api/pagamentos/fake/pagar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ consultaId: pagamento.consultaId }),
      });
      if (!r.ok) {
        setErroTeste("Não foi possível simular o pagamento.");
        return;
      }
      // O webhook já rodou; o polling confirmaria em segundos, mas antecipamos.
      aoPagar();
    } catch {
      setErroTeste("Não foi possível simular o pagamento.");
    } finally {
      setPagandoTeste(false);
    }
  };

  const mm = String(Math.floor(restanteSeg / 60)).padStart(2, "0");
  const ss = String(restanteSeg % 60).padStart(2, "0");

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center sm:p-8">
      <h2 className="font-serif text-xl text-slate-900">Pague para confirmar</h2>
      <p className="mx-auto mt-1 max-w-sm text-sm text-slate-600">
        {pagamento.rotulo}
        {pagamento.valorCent > 0 && (
          <>
            {" · "}
            <span className="font-semibold text-slate-900">
              {formatarBRL(pagamento.valorCent)}
            </span>
          </>
        )}
      </p>

      {/* Pagar online (Pix/cartão/boleto) — recomendado. Fora do modo teste,
          onde o link é fictício e o pagamento se simula pelo botão abaixo. */}
      {pagamento.linkPagamento && !pagamento.teste && (
        <div className="mx-auto mt-4 max-w-sm rounded-xl border border-teal-200 bg-teal-50/60 p-4 text-left">
          <p className="text-sm font-semibold text-teal-900">Pagar online</p>
          <p className="mt-0.5 text-xs text-slate-500">
            Abra a página segura e pague por Pix, cartão ou boleto.
          </p>
          <a
            href={pagamento.linkPagamento}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 block rounded-lg bg-teal-800 px-4 py-2 text-center text-sm font-semibold text-white hover:bg-teal-900"
          >
            Abrir página de pagamento
          </a>
        </div>
      )}

      {/* Pix direto (QR + copia-e-cola). Some se o provedor não devolver o QR. */}
      {pagamento.copiaCola && (
        <>
          <p className="mt-4 text-sm text-slate-600">
            {pagamento.linkPagamento
              ? "Ou escaneie o QR do Pix no app do seu banco:"
              : "Escaneie o QR no app do seu banco ou use o Pix copia-e-cola:"}
          </p>

          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={pagamento.qrBase64}
            alt="QR Code do Pix"
            width={220}
            height={220}
            className="mx-auto mt-4 h-56 w-56 rounded-lg border border-slate-200"
          />

          <div className="mx-auto mt-4 flex max-w-sm items-stretch gap-2">
            <input
              readOnly
              value={pagamento.copiaCola}
              onFocus={(e) => e.currentTarget.select()}
              className="min-w-0 flex-1 truncate rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-xs text-slate-700"
            />
            <button
              type="button"
              onClick={copiar}
              className="shrink-0 rounded-lg bg-teal-800 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-900"
            >
              {copiado ? "Copiado ✓" : "Copiar"}
            </button>
          </div>
        </>
      )}

      <p className="mt-5 text-sm text-slate-600">
        Este horário fica reservado por{" "}
        <span className="font-mono font-semibold text-slate-900">
          {mm}:{ss}
        </span>
        . Assim que o pagamento cair, sua consulta é confirmada — pode deixar esta
        tela aberta.
      </p>

      {pagamento.teste && (
        <div className="mx-auto mt-6 max-w-sm rounded-xl border border-dashed border-amber-300 bg-amber-50 p-4">
          <p className="text-xs font-medium text-amber-900">
            Ambiente de teste — nenhum Pix real é gerado.
          </p>
          <button
            type="button"
            onClick={pagarTeste}
            disabled={pagandoTeste}
            className="mt-2 rounded-lg bg-amber-700 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-800 disabled:opacity-50"
          >
            {pagandoTeste ? "Confirmando…" : "Simular pagamento"}
          </button>
          {erroTeste && <p className="mt-2 text-xs text-red-700">{erroTeste}</p>}
        </div>
      )}

      <button
        type="button"
        onClick={aoCancelar}
        className="mt-6 text-sm text-slate-500 underline underline-offset-2 hover:text-slate-800"
      >
        Escolher outro horário
      </button>
    </div>
  );
}

function Campo({
  nome,
  rotulo,
  tipo = "text",
  obrigatorio = false,
  className = "",
}: {
  nome: string;
  rotulo: string;
  tipo?: string;
  obrigatorio?: boolean;
  className?: string;
}) {
  return (
    <div className={className}>
      <label htmlFor={nome} className="text-sm font-medium text-slate-700">
        {rotulo}
        {obrigatorio && <span className="text-red-600"> *</span>}
      </label>
      <input
        id={nome}
        name={nome}
        type={tipo}
        required={obrigatorio}
        autoComplete={
          { nome: "name", email: "email", telefone: "tel", nascimento: "bday" }[nome] ??
          "off"
        }
        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-700 focus:ring-1 focus:ring-teal-700"
      />
    </div>
  );
}
