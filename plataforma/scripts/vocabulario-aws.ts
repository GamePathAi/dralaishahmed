/**
 * Registra (ou atualiza) o vocabulário customizado da Amazon Transcribe.
 *
 *     npm run vocabulario:aws
 *
 * Substitui o truque que o Whisper permitia pelo campo `prompt`: enviesar o
 * reconhecimento com termos que a Dra. Laís usa e que o modelo genérico erra.
 * Nome de medicação e posologia são onde o erro custa caro — "losartana 50"
 * virando "lorazepam 50" num prontuário é dano real, não ruído.
 *
 * **Esta lista deve crescer com o uso.** Toda vez que a médica corrigir o mesmo
 * termo no modal de revisão, ele é candidato a entrar aqui.
 *
 * O job de transcrição referencia o vocabulário pelo nome. Enquanto ele não
 * existir na conta, a transcrição funciona — só erra mais.
 */

import {
  TranscribeClient,
  CreateVocabularyCommand,
  UpdateVocabularyCommand,
  GetVocabularyCommand,
} from "@aws-sdk/client-transcribe";
import { VOCABULARIO } from "../src/lib/ia/transcricao";

const cliente = new TranscribeClient({
  region: process.env.AWS_REGION ?? "sa-east-1",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});

/**
 * Um termo por entrada. A Transcribe aceita frases com hífen no lugar do
 * espaço (`hemograma-completo`), o que ajuda em expressões que ela quebraria.
 */
const TERMOS = [
  // medicações frequentes
  "losartana", "enalapril", "hidroclorotiazida", "anlodipino", "atenolol",
  "metformina", "glibenclamida", "insulina-NPH", "insulina-regular",
  "sinvastatina", "atorvastatina", "rosuvastatina",
  "omeprazol", "pantoprazol", "ranitidina",
  "dipirona", "paracetamol", "ibuprofeno", "nimesulida", "diclofenaco",
  "amoxicilina", "azitromicina", "cefalexina", "ciprofloxacino", "nitrofurantoina",
  "prednisona", "dexametasona", "budesonida", "salbutamol", "formoterol",
  "sertralina", "fluoxetina", "escitalopram", "clonazepam", "amitriptilina",
  "levotiroxina", "metildopa", "dimenidrinato", "loratadina", "dexclorfeniramina",

  // posologia
  "miligramas", "microgramas", "mililitros", "comprimido", "cápsula",
  "de-oito-em-oito-horas", "de-doze-em-doze-horas", "de-seis-em-seis-horas",
  "uma-vez-ao-dia", "duas-vezes-ao-dia", "via-oral", "sublingual", "intramuscular",
  "se-dor", "se-febre", "em-jejum", "após-as-refeições",

  // exames
  //
  // SEM DÍGITOS: vocabulário pt-BR da Transcribe rejeita números, e um único
  // termo inválido reprova a lista inteira. "T4-livre" derrubou a primeira
  // versão deste arquivo — por isso "tiroxina-livre" no lugar.
  "hemograma-completo", "glicemia-de-jejum", "hemoglobina-glicada",
  "TSH", "tiroxina-livre", "creatinina", "ureia", "TGO", "TGP",
  "colesterol-total", "triglicerídeos", "sumário-de-urina", "urocultura",
  "eletrocardiograma", "ecocardiograma", "raio-X-de-tórax", "ultrassonografia",

  // termos clínicos
  "hipótese-diagnóstica", "queixa-principal", "história-da-moléstia-atual",
  "antecedentes-pessoais", "antecedentes-familiares", "sinais-vitais",
  "pressão-arterial", "frequência-cardíaca", "saturação",
  "rinossinusite", "faringoamigdalite", "gastroenterite", "lombalgia",
  "cefaleia", "dislipidemia", "hipertensão-arterial", "diabetes-mellitus",
  "infecção-do-trato-urinário", "dispneia", "êmese", "pirose", "astenia",
];

async function main() {
  if (!process.env.AWS_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID === "PREENCHER") {
    console.error("\nPreencha as credenciais AWS no .env antes de rodar.\n");
    process.exit(1);
  }

  // Valida antes de enviar: a AWS reprova a lista INTEIRA por causa de um
  // único termo, e a mensagem só chega minutos depois, no estado FAILED.
  const invalidos = TERMOS.filter((t) => /[^A-Za-zÀ-ÿ\-']/.test(t));
  if (invalidos.length > 0) {
    console.error(
      `\nTermos inválidos (a Transcribe pt-BR não aceita dígitos nem símbolos):\n` +
        invalidos.map((t) => `  ${t}`).join("\n") +
        "\n",
    );
    process.exit(1);
  }

  const existe = await cliente
    .send(new GetVocabularyCommand({ VocabularyName: VOCABULARIO }))
    .then(() => true)
    .catch(() => false);

  const entrada = {
    VocabularyName: VOCABULARIO,
    LanguageCode: "pt-BR" as const,
    Phrases: TERMOS,
  };

  if (existe) {
    await cliente.send(new UpdateVocabularyCommand(entrada));
    console.log(`\n✓ Vocabulário "${VOCABULARIO}" atualizado — ${TERMOS.length} termos.`);
  } else {
    await cliente.send(new CreateVocabularyCommand(entrada));
    console.log(`\n✓ Vocabulário "${VOCABULARIO}" criado — ${TERMOS.length} termos.`);
  }

  console.log(
    "\nA AWS leva alguns minutos para processar. Enquanto o estado não for\n" +
      "READY, os jobs que o referenciam falham — confira no console da\n" +
      "Transcribe antes da primeira consulta real.\n",
  );
}

main().catch((e) => {
  console.error("\nFalha ao registrar o vocabulário:", e.message ?? e);
  process.exitCode = 1;
});
