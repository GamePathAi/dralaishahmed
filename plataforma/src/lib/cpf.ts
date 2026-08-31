/**
 * Validação de CPF — puro, sem dependência, usável no cliente e no servidor.
 *
 * Existe para dar um erro claro ANTES de mandar um CPF errado ao provedor de
 * pagamento (o Asaas rejeitaria com uma mensagem crua, e o paciente veria só
 * "não foi possível gerar o Pix"). Aqui um dígito trocado vira uma mensagem
 * específica no formulário.
 */

/** Só os dígitos. */
export function limparCpf(cpf: string): string {
  return cpf.replace(/\D/g, "");
}

/** Valida os dígitos verificadores do CPF (algoritmo oficial). */
export function cpfValido(entrada: string): boolean {
  const cpf = limparCpf(entrada);
  if (cpf.length !== 11) return false;
  // Rejeita sequências repetidas (000..., 111...), que passam no cálculo.
  if (/^(\d)\1{10}$/.test(cpf)) return false;

  const digito = (ateIndice: number) => {
    let soma = 0;
    let peso = ateIndice + 1;
    for (let i = 0; i < ateIndice; i++) soma += Number(cpf[i]) * peso--;
    const resto = (soma * 10) % 11;
    return resto === 10 ? 0 : resto;
  };

  return digito(9) === Number(cpf[9]) && digito(10) === Number(cpf[10]);
}

/** Formata "12345678909" → "123.456.789-09" (para exibição). */
export function formatarCpf(entrada: string): string {
  const cpf = limparCpf(entrada).slice(0, 11);
  return cpf
    .replace(/^(\d{3})(\d)/, "$1.$2")
    .replace(/^(\d{3})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/\.(\d{3})(\d)/, ".$1-$2");
}
