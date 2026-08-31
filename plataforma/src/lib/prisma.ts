import { PrismaClient } from "@prisma/client";

// Em dev o hot reload recria o módulo a cada alteração; sem o singleton global
// isso vaza conexões até o Postgres recusar novas.
const globalParaPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalParaPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalParaPrisma.prisma = prisma;
