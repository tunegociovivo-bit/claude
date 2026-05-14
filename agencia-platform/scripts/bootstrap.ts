/**
 * Idempotent bootstrap para producción (Railway / VPS):
 * 1. Aplica migraciones pendientes.
 * 2. Si la BD está vacía (0 usuarios), corre el seed con los datos demo.
 * 3. Nunca borra datos en una BD ya inicializada.
 *
 * Pensado para correr antes de `next start`.
 */

import { execSync } from "child_process";
import { PrismaClient } from "@prisma/client";

async function main() {
    console.log("[bootstrap] Aplicando migraciones…");
    execSync("npx prisma migrate deploy", { stdio: "inherit" });

  const prisma = new PrismaClient();
    try {
          let userCount = 0;
          try {
                  userCount = await prisma.user.count();
          } catch (e: any) {
                  // P2021 = tabla no existe todavía (migraciones pendientes o BD vacía)
            if (e?.code === "P2021") {
                      console.log("[bootstrap] Tablas no encontradas, asumiendo BD vacía.");
                      userCount = 0;
            } else {
                      throw e;
            }
          }

      if (userCount > 0) {
              console.log(`[bootstrap] BD ya inicializada (${userCount} usuarios). Saltando seed.`);
              return;
      }
          console.log("[bootstrap] BD vacía detectada — corriendo seed inicial…");
          await prisma.$disconnect();
          execSync("npx tsx scripts/seed.ts", { stdio: "inherit" });
    } finally {
          await prisma.$disconnect().catch(() => {});
    }
}

main().catch((e) => {
    console.error("[bootstrap] Error fatal:", e);
    process.exit(1);
});
