/**
 * Conclusão do primeiro acesso: senha + QR + confirmação do código.
 *
 * Server component valida o token e GERA o segredo aqui — o QR já chega pronto
 * na tela, sem chamada intermediária. O segredo viaja no formulário e volta na
 * conclusão; quem tem o link controla a configuração de qualquer forma, então
 * isso não amplia superfície: o gate é o token de uso único.
 */

import { prisma } from "@/lib/prisma";
import { gerarSegredoTotp } from "@/lib/seguranca";
import { uriAutenticador, qrSvg } from "@/lib/segundo-fator";
import { FormularioPrimeiroAcesso } from "@/components/auth/FormularioPrimeiroAcesso";

export const metadata = { title: "Configurar acesso" };
export const dynamic = "force-dynamic";

const PREFIXO = "primeiro-acesso:";

export default async function PaginaConcluirPrimeiroAcesso({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const registro = await prisma.tokenVerificacao.findFirst({
    where: { token, identifier: { startsWith: PREFIXO } },
  });

  const valido = !!registro && registro.expires >= new Date();

  if (!valido) {
    return (
      <main className="grid min-h-dvh place-items-center bg-slate-100 px-4">
        <div className="w-full max-w-md rounded-2xl bg-white p-8 text-center shadow-sm">
          <h1 className="font-serif text-xl text-slate-900">Link expirado</h1>
          <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-slate-600">
            Este link de configuração venceu ou já foi usado. Peça um novo —
            leva um minuto.
          </p>
          <a
            href="/primeiro-acesso"
            className="mt-5 inline-block rounded-xl bg-teal-800 px-6 py-3 text-sm font-semibold text-white hover:bg-teal-900"
          >
            Pedir novo link
          </a>
        </div>
      </main>
    );
  }

  const email = registro.identifier.slice(PREFIXO.length);

  // Segredo novo a cada carregamento da página. Só o que for CONFIRMADO com o
  // código do aplicativo é gravado — recarregar a página descarta o anterior.
  const segredo = gerarSegredoTotp();
  const uri = uriAutenticador({
    email,
    segredo,
    // Rótulo com o domínio: distingue esta entrada de qualquer resto de teste
    // no aplicativo. Entradas gêmeas já causaram horas de "credencial inválida".
    ambiente: "consulta.dralaishahmed.com.br",
  });
  const svg = await qrSvg(uri);

  return (
    <main className="grid min-h-dvh place-items-center bg-slate-100 px-4 py-8">
      <FormularioPrimeiroAcesso token={token} segredo={segredo} svg={svg} email={email} />
    </main>
  );
}
