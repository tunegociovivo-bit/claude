/**
 * FASE 1 · Punto 2 — Auditoría de migración de auth Bubui (SOLO LECTURA).
 *
 * Mide cuántos clientes/negocios NO tienen apiToken y cuántos siguen ACTIVOS sin
 * token: son exactamente los que un cambio a modo "strict" dejaría fuera. Sirve
 * para decidir CUÁNDO es seguro activar strict (cuando el número de activos sin
 * token cae ~0). No modifica nada.
 *
 *   npx tsx scripts/bubui-auth-audit.ts
 *   ACTIVE_DAYS=14 npx tsx scripts/bubui-auth-audit.ts
 */
import { prisma } from "@/lib/db/prisma";

async function main() {
  const activeDays = Number(process.env.ACTIVE_DAYS ?? "30");
  const since = new Date(Date.now() - activeDays * 86_400_000);

  const [custTotal, custNoToken, custActiveNoToken] = await Promise.all([
    prisma.bubuiCustomer.count(),
    prisma.bubuiCustomer.count({ where: { apiToken: null } }),
    prisma.bubuiCustomer.count({ where: { apiToken: null, lastSeenAt: { gte: since } } })
  ]);

  const [bizTotal, bizNoToken] = await Promise.all([
    prisma.bubuiBusiness.count(),
    prisma.bubuiBusiness.count({ where: { apiToken: null } })
  ]);

  console.log("── Auditoría auth Bubui (solo lectura) ──");
  console.log(`Ventana de actividad: últimos ${activeDays} días (desde ${since.toISOString()})`);
  console.log("");
  console.log("CLIENTES (BubuiCustomer):");
  console.log(`  total:                 ${custTotal}`);
  console.log(`  sin apiToken:          ${custNoToken}`);
  console.log(`  sin token Y ACTIVOS:   ${custActiveNoToken}   <- impacto de activar strict AHORA`);
  console.log("");
  console.log("NEGOCIOS (BubuiBusiness):");
  console.log(`  total:                 ${bizTotal}`);
  console.log(`  sin apiToken:          ${bizNoToken}   <- paneles que re-piden login al activar strict`);
  console.log("");
  if (custActiveNoToken === 0 && bizNoToken === 0) {
    console.log("✅ Seguro activar strict: no hay clientes activos ni negocios sin token.");
  } else {
    console.log(
      "⚠️  Aún hay tráfico legacy. Recomendado: modo 'shadow' un tiempo, re-medir, y activar 'strict' cuando 'sin token Y ACTIVOS' ≈ 0."
    );
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
