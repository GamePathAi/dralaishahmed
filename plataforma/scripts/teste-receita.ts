/**
 * Teste pontual: a IA extrai a receita estruturada de uma transcrição?
 * Uso: npx tsx scripts/teste-receita.ts   (precisa da chave real da Anthropic)
 */
import { gerarNotasClinicas } from "@/lib/ia/notas-clinicas";

const transcricao = `
Médica: pelo que você descreveu, parece uma faringite. Vou passar dipirona 500 miligramas, um comprimido de 6 em 6 horas se tiver dor ou febre, por 5 dias.
Paciente: certo.
Médica: e amoxicilina 500 miligramas, uma cápsula de 8 em 8 horas por 7 dias, uma caixa com 21 cápsulas.
Paciente: tá bom.
Médica: como você falou da ansiedade e da insônia, vou receitar também clonazepam 2 miligramas, meio comprimido à noite antes de dormir, por 15 dias. Beba bastante água e volte em uma semana.
`.trim();

async function main() {
  const { relatorio, prescricao, modelo } = await gerarNotasClinicas(transcricao, {
    nome: "Paciente Teste",
    idade: 34,
  });
  console.log("modelo:", modelo);
  console.log("houvePrescricao:", prescricao.houvePrescricao);
  console.log("itens:");
  for (const it of prescricao.itens) {
    console.log(
      `  - ${it.medicamento} ${it.concentracao} | ${it.posologia} | qtd: ${it.quantidade || "-"} | controlado: ${it.controlado}`,
    );
  }
  console.log("orientacoesGerais:", prescricao.orientacoesGerais);
  console.log("pontosParaRevisao:", prescricao.pontosParaRevisao);
  console.log("conduta (relatorio):", relatorio.conduta.slice(0, 200));
}

main().catch((e) => {
  console.error("FALHOU:", e);
  process.exit(1);
});
