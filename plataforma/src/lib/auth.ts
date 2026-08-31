/**
 * Autenticação (Auth.js v5).
 *
 * Dois papéis com exigências bem diferentes:
 *
 *  • Paciente — magic link por e-mail. Não cria senha, não esquece senha, e não
 *    há senha fraca para vazar. Para quem entra na plataforma poucas vezes por
 *    ano, é a opção com menos atrito e menos superfície de ataque.
 *
 *  • Médica — senha + TOTP. Ela tem acesso a TODOS os prontuários; magic link
 *    aqui significaria que quem tomasse a caixa de e-mail dela tomaria a base
 *    inteira. O segundo fator não é opcional.
 */

import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Nodemailer from "next-auth/providers/nodemailer";
import { prisma } from "@/lib/prisma";
import { AdapterPrismaClinica } from "@/lib/auth-adapter";
import { verificarSenha, verificarTotp } from "@/lib/seguranca";
import { consumir, liberar } from "@/lib/rate-limit";

declare module "next-auth" {
  interface User {
    papel?: "PACIENTE" | "MEDICA";
  }
  interface Session {
    user: {
      id: string;
      papel: "PACIENTE" | "MEDICA";
      name?: string | null;
      email?: string | null;
    };
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: AdapterPrismaClinica(),
  session: { strategy: "jwt", maxAge: 60 * 60 * 8 },
  pages: { signIn: "/entrar" },

  providers: [
    // ---- paciente: magic link -------------------------------------------
    Nodemailer({
      server: process.env.EMAIL_SERVER,
      from: process.env.EMAIL_FROM,
      maxAge: 15 * 60, // link vale 15 min
    }),

    // ---- médica: senha + TOTP -------------------------------------------
    Credentials({
      id: "medica",
      name: "Acesso profissional",
      credentials: {
        email: { label: "E-mail", type: "email" },
        senha: { label: "Senha", type: "password" },
        totp: { label: "Código do aplicativo", type: "text" },
      },
      async authorize(dados) {
        const email = String(dados?.email ?? "").toLowerCase().trim();
        const senha = String(dados?.senha ?? "");
        const totp = String(dados?.totp ?? "");
        // Senha com teto: sem isto, uma senha de MB estoura CPU no scrypt a
        // cada tentativa — força bruta vira DoS. 200 cobre qualquer senha real.
        if (!email || !senha || senha.length > 200 || !totp) return null;

        // Lockout por CONTA, não por IP. O segundo fator só protege enquanto a
        // senha é secreta; vazada a senha, restam 1.000.000 de códigos TOTP,
        // forçáveis em minutos SEM limite. Cinco falhas travam por 15 min,
        // independentemente de onde vêm — o que devolve ao TOTP o seu papel.
        const chave = `login:${email}`;
        const limite = consumir(chave, 5, 15 * 60_000);
        if (!limite.ok) return null;

        const usuario = await prisma.usuario.findUnique({
          where: { email },
          select: {
            id: true, nome: true, email: true, papel: true,
            senhaHash: true, totpSecret: true,
          },
        });

        // Credenciais só valem para a médica — paciente entra por magic link.
        if (!usuario || usuario.papel !== "MEDICA") return null;
        if (!usuario.senhaHash || !usuario.totpSecret) return null;

        // Verifica os dois fatores antes de decidir. Retornar cedo no primeiro
        // que falha vaza, pelo tempo de resposta, qual dos dois estava errado.
        const senhaOk = await verificarSenha(senha, usuario.senhaHash);
        const totpOk = verificarTotp(totp, usuario.totpSecret);
        if (!senhaOk || !totpOk) return null;

        // Sucesso zera o contador — quem acerta não fica perto do lockout.
        liberar(chave);

        return {
          id: usuario.id,
          name: usuario.nome,
          email: usuario.email,
          papel: "MEDICA" as const,
        };
      },
    }),
  ],

  callbacks: {
    /**
     * Porteiro do magic link. Roda ANTES do envio (com
     * `email.verificationRequest`), então recusar aqui impede o e-mail de sair.
     *
     * Duas recusas, por motivos diferentes:
     *
     * 1. **Quem não tem cadastro não recebe link.** Sem isto, o Auth.js criaria
     *    conta para qualquer endereço digitado — bastaria alguém varrer e-mails
     *    no formulário para encher a base de pacientes fantasma.
     *
     * 2. **A médica não entra por link.** O e-mail dela é um usuário como outro
     *    qualquer; sem esta checagem, pedir link mágico no formulário de
     *    paciente daria acesso a TODOS os prontuários sem o segundo fator —
     *    exatamente o que a autenticação dela foi desenhada para impedir.
     *    Quem tomasse a caixa de e-mail dela tomaria a base inteira.
     *
     * A tela mostra a mesma mensagem nos dois casos: dizer "não há cadastro"
     * revelaria, a qualquer um, se uma pessoa é paciente daqui.
     */
    async signIn({ user, account, email }) {
      if (account?.provider !== "nodemailer") return true;

      const endereco = user?.email?.toLowerCase().trim();
      if (!endereco) return false;

      const existente = await prisma.usuario.findUnique({
        where: { email: endereco },
        select: { papel: true },
      });

      if (!existente) return false;
      if (existente.papel !== "PACIENTE") return false;

      // Cooldown de envio, só quando é PEDIDO de link (não no clique).
      // Sem isto, quem conhece o e-mail de um paciente dispara /signin em loop
      // e enche a caixa dele de links — além de queimar cota e reputação do
      // Zoho. Um envio por endereço a cada 60s é folga para uso real.
      if (email?.verificationRequest) {
        const limite = consumir(`maglink:${endereco}`, 1, 60_000);
        if (!limite.ok) return false;
      }

      return true;
    },

    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.papel = user.papel ?? "PACIENTE";
      }
      return token;
    },
    async session({ session, token }) {
      session.user.id = token.id as string;
      session.user.papel = (token.papel as "PACIENTE" | "MEDICA") ?? "PACIENTE";
      return session;
    },
  },
});
