/**
 * Texto oficial do consentimento de gravação — fonte única, lida pelo servidor.
 *
 * Antes, o texto vivia só no componente cliente e o servidor gravava o que o
 * cliente mandava como "prova do que o paciente leu" — um cliente adulterado
 * registrava qualquer coisa (inclusive "não autorizo") com `aceito: true`,
 * destruindo o valor probatório do consentimento LGPD guardado por 20 anos.
 *
 * Aqui o texto é canônico. O cliente envia apenas a VERSÃO; o servidor resolve
 * o texto correspondente e grava a cópia dele. Para revisar o texto, adicione
 * uma versão nova ao mapa — nunca edite uma existente, senão registros antigos
 * passam a apontar para um texto que o paciente não viu.
 */

export const VERSAO_TEXTO_CONSENTIMENTO = "2026-08-v1";

const TEXTO_2026_08_V1 = `Durante esta teleconsulta, um assistente de inteligência artificial pode registrar o áudio da conversa com uma única finalidade: ajudar a médica a redigir o registro no seu prontuário.

Como funciona:
• O áudio é transcrito automaticamente e apagado logo em seguida. Ele não é guardado.
• A transcrição é organizada em um rascunho de prontuário.
• A médica revisa, corrige e assina esse rascunho. Nada entra no seu prontuário sem revisão dela.
• A transcrição fica sob sigilo médico, com a mesma proteção de qualquer registro clínico.
• O processamento usa serviços de tecnologia contratados, sob contrato de confidencialidade.

Seus direitos:
• Você pode recusar. A consulta acontece normalmente, do mesmo jeito, sem qualquer prejuízo.
• Você pode mudar de ideia durante a consulta. A gravação para na hora e o que foi captado é descartado.
• Você pode pedir acesso, correção ou exclusão dos seus dados a qualquer momento.

A gravação não substitui o prontuário e não é compartilhada com ninguém além da equipe de saúde que atende você.`;

/** Versão → texto. Só valores deste mapa são aceitos pelo servidor. */
const TEXTOS: Record<string, string> = {
  [VERSAO_TEXTO_CONSENTIMENTO]: TEXTO_2026_08_V1,
};

/** Texto atual, para exibir ao paciente. */
export const TEXTO_CONSENTIMENTO = TEXTOS[VERSAO_TEXTO_CONSENTIMENTO];

/** Texto canônico de uma versão, ou `null` se a versão é desconhecida. */
export function textoOficialDaVersao(versao: string): string | null {
  return TEXTOS[versao] ?? null;
}
