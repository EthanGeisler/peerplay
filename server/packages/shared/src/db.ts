import { PrismaClient } from "@prisma/client";

// Ensure BigInt can be serialized to JSON (Prisma returns BigInt for Int8/BigInt columns)
(BigInt.prototype as any).toJSON = function () {
  return Number(this);
};

export const db = new PrismaClient({
  log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
});
