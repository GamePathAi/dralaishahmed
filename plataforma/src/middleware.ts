/**
 * Proteção de rotas na borda.
 *
 * Esta é a **primeira** camada, não a única. Cada página e cada rota de API
 * repete a checagem por conta própria — o middleware evita renderizar tela que
 * a pessoa não deveria ver, mas quem chamasse a API direto passaria por cima
 * dele. Defesa que existe num lugar só é defesa que falha quando alguém
 * esquece de aplicá-la numa rota nova.
 *
 * O middleware lê o JWT do cookie, sem tocar no banco: ele roda em toda
 * requisição, e uma consulta ao Postgres aqui viraria gargalo.
 */

import { NextResponse, type NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";

/** Prefixos exclusivos da médica. */
const AREA_MEDICA = ["/agenda", "/pacientes", "/atendimento", "/seguranca", "/configuracoes"];

/** Prefixos que exigem apenas estar autenticado. */
const AREA_PACIENTE = ["/minhas-consultas", "/sala"];

/**
 * Compara por SEGMENTO, não por prefixo de string.
 *
 * `startsWith("/agenda")` casa com `/agendar` — a página pública de
 * agendamento — e mandava todo visitante anônimo para o login. Um prefixo só
 * vale quando termina no fim do caminho ou numa barra.
 */
function naArea(pathname: string, prefixo: string): boolean {
  return pathname === prefixo || pathname.startsWith(`${prefixo}/`);
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  const exigeMedica = AREA_MEDICA.some((p) => naArea(pathname, p));
  const exigeSessao =
    exigeMedica || AREA_PACIENTE.some((p) => naArea(pathname, p));

  if (!exigeSessao) return NextResponse.next();

  const token = await getToken({
    req,
    secret: process.env.AUTH_SECRET,
    secureCookie: process.env.NODE_ENV === "production",
  });

  if (!token) {
    const url = req.nextUrl.clone();
    url.pathname = "/entrar";
    url.search = `?destino=${encodeURIComponent(pathname)}`;
    return NextResponse.redirect(url);
  }

  if (exigeMedica && token.papel !== "MEDICA") {
    // Paciente tentando abrir área clínica não recebe "não autorizado" — é
    // levado ao que é dele. Um 403 aqui só confirmaria que a rota existe.
    const url = req.nextUrl.clone();
    url.pathname = "/minhas-consultas";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  // Exclui estáticos e as próprias rotas de autenticação — proteger `/api/auth`
  // impediria o login de acontecer.
  matcher: [
    "/((?!api/auth|_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|webp|ico)$).*)",
  ],
};
