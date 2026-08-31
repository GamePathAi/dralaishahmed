/**
 * Dados de rede da requisição, para a trilha de auditoria.
 *
 * O IP guardado no prontuário precisa valer por 20 anos, então não pode ser
 * forjável. O `x-forwarded-for` NÃO serve: o nginx usa
 * `$proxy_add_x_forwarded_for`, que ANEXA o IP real ao valor que o cliente
 * mandou — um `curl -H "X-Forwarded-For: 8.8.8.8"` grava `8.8.8.8, <ip-real>`,
 * poluindo o registro com lixo escolhido pelo cliente.
 *
 * `x-real-ip` é definido pelo nginx como `$remote_addr` (o IP da conexão TCP),
 * que o cliente não controla. É o único header confiável atrás deste proxy.
 */

export function ipDoPedido(req: Request): string | undefined {
  const real = req.headers.get("x-real-ip")?.trim();
  if (real) return real;

  // Sem proxy (dev local), cai no XFF pegando o ÚLTIMO elemento — o que o
  // primeiro salto confiável anexou, não o que o cliente injetou na frente.
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",").at(-1)?.trim();

  return undefined;
}
