/**
 * Adapter do Auth.js sobre o nosso schema.
 *
 * Por que não o `@auth/prisma-adapter` oficial: ele acessa `prisma.user`,
 * `prisma.account`, `prisma.session` e `prisma.verificationToken` — nomes
 * fixos, derivados de modelos que ele espera encontrar no schema. O nosso
 * domínio é `Usuario`, em português como todo o resto, e não tem Account nem
 * Session. Com o adapter oficial, `prisma.user` é `undefined` e o login do
 * paciente estoura em `getUserByEmail` antes de tentar enviar qualquer e-mail.
 *
 * A alternativa seria renomear `Usuario` para `User`. Custaria o schema, o
 * seed, as rotas, o prontuário e a legibilidade do domínio inteiro para
 * agradar uma convenção de biblioteca. Traduzir na fronteira é mais barato e
 * deixa a dependência onde ela deve ficar: na borda.
 *
 * A sessão é JWT (`strategy: "jwt"`), então os métodos de sessão
 * (`createSession`, `getSessionAndUser`, `updateSession`, `deleteSession`)
 * nunca são chamados e não estão aqui. Se um dia a estratégia virar `database`,
 * eles passam a ser obrigatórios — e o login quebra em silêncio sem eles.
 */

import type { Adapter, AdapterUser } from "next-auth/adapters";
import { prisma } from "@/lib/prisma";
import type { Usuario } from "@prisma/client";

/** Traduz a linha do banco para o formato que o Auth.js espera. */
function paraAdapterUser(u: Usuario): AdapterUser {
  return {
    id: u.id,
    email: u.email,
    emailVerified: u.emailVerificadoEm,
    name: u.nome,
  };
}

export function AdapterPrismaClinica(): Adapter {
  return {
    // ---- usuários --------------------------------------------------------

    async createUser(dados) {
      // Só chega aqui quem passou pelo callback `signIn`, que exige cadastro
      // prévio. Na prática o usuário sempre existe; isto é rede de segurança.
      const u = await prisma.usuario.create({
        data: {
          email: dados.email,
          nome: dados.name ?? dados.email,
          emailVerificadoEm: dados.emailVerified ?? null,
          papel: "PACIENTE",
          paciente: { create: {} },
        },
      });
      return paraAdapterUser(u);
    },

    async getUser(id) {
      const u = await prisma.usuario.findUnique({ where: { id } });
      return u ? paraAdapterUser(u) : null;
    },

    async getUserByEmail(email) {
      const u = await prisma.usuario.findUnique({
        where: { email: email.toLowerCase().trim() },
      });
      return u ? paraAdapterUser(u) : null;
    },

    async updateUser(dados) {
      const u = await prisma.usuario.update({
        where: { id: dados.id! },
        data: {
          // O nome NÃO é sobrescrito aqui. Ele veio do agendamento e alimenta
          // o prontuário; deixar o Auth.js reescrevê-lo abriria caminho para
          // um dado clínico mudar por efeito colateral de login.
          ...(dados.email ? { email: dados.email } : {}),
          ...(dados.emailVerified !== undefined
            ? { emailVerificadoEm: dados.emailVerified }
            : {}),
        },
      });
      return paraAdapterUser(u);
    },

    // ---- contas de provedor externo --------------------------------------
    // Não há login social. Implementados como no-op porque o Auth.js os chama
    // no fluxo genérico; lançar erro aqui derrubaria o magic link.

    async getUserByAccount() {
      return null;
    },

    async linkAccount() {
      return undefined;
    },

    // ---- token do magic link ---------------------------------------------

    async createVerificationToken(token) {
      await prisma.tokenVerificacao.create({
        data: {
          identifier: token.identifier,
          token: token.token,
          expires: token.expires,
        },
      });
      return token;
    },

    /**
     * Consome o token. O `delete` é a parte que importa: um link de acesso vale
     * UMA vez. Sem a remoção, o mesmo link no histórico do navegador ou
     * encaminhado por engano continuaria abrindo o prontuário.
     */
    async useVerificationToken({ identifier, token }) {
      try {
        const usado = await prisma.tokenVerificacao.delete({
          where: { identifier_token: { identifier, token } },
        });
        return {
          identifier: usado.identifier,
          token: usado.token,
          expires: usado.expires,
        };
      } catch {
        // Token inexistente ou já usado. O Auth.js trata `null` como link
        // inválido, que é exatamente o caso.
        return null;
      }
    },
  };
}
