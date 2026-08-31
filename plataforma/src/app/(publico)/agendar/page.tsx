import type { Metadata } from "next";
import { FormularioAgendamento } from "@/components/agenda/FormularioAgendamento";
import { env } from "@/lib/env";
import { provedorPagamento } from "@/lib/pagamento";

export const metadata: Metadata = {
  title: "Agendar consulta | Dra. Laís Caroline Hahmed",
  description:
    "Agende teleconsulta ou consulta presencial com a Dra. Laís Caroline Hahmed — CRM-MS 16563.",
};

export default function PaginaAgendar() {
  // Só pede CPF quando o checkout está ligado E o provedor exige (Asaas). Com o
  // pagamento desligado, o formulário fica como sempre.
  const exigeCpf = env.PAGAMENTO_ATIVO && provedorPagamento().exigeCpf;
  return (
    <main className="mx-auto max-w-2xl px-4 py-10 sm:py-14">
      <header className="mb-8">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-teal-800">
          Agendamento
        </p>
        <h1 className="mt-2 font-serif text-3xl text-slate-900">
          Marcar consulta
        </h1>
        <p className="mt-2 text-slate-600">
          Escolha o horário e informe seus dados. Você recebe a confirmação e o
          link de acesso por e-mail.
        </p>
      </header>

      <FormularioAgendamento exigeCpf={exigeCpf} />

      {/* Aviso de urgência: exigência prática de qualquer canal de agendamento
          médico. Alguém em emergência não pode ser deixado esperando uma vaga. */}
      <aside className="mt-10 rounded-xl border border-red-200 bg-red-50 p-4">
        <p className="text-sm leading-relaxed text-red-900">
          <strong>Em caso de urgência ou emergência</strong>, não aguarde o
          agendamento. Procure o serviço de saúde mais próximo ou ligue{" "}
          <a href="tel:192" className="font-semibold underline underline-offset-2">
            192 (SAMU)
          </a>
          .
        </p>
      </aside>
    </main>
  );
}
