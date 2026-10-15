/* eslint-disable no-console */
// Arnés e2e del radar: con el portal ficticio levantado y Chromium local,
// crea un negocio con el módulo radar, una fuente con credenciales, dos
// búsquedas, ejecuta una revisión real y comprueba coches, coincidencias y
// que la contraseña queda cifrada. Stubbea los avisos (WhatsApp/email).
import { spawn } from "node:child_process";
import assert from "node:assert/strict";

const PORT = 4599;
const BASE = `http://127.0.0.1:${PORT}`;

// Portal de prueba inyectado en el catálogo.
process.env.RADAR_TEST_PORTALS_JSON = JSON.stringify([
  {
    key: "testportal",
    name: "Portal de prueba",
    hosts: ["127.0.0.1"],
    loginUrl: `${BASE}/login`,
    listingUrls: [`${BASE}/vehicles`],
    loggedIn: { textIncludes: ["Cerrar sesión"] },
    defaultCountry: "ES",
    apiPathIncludes: ["/api/search"],
  },
]);
process.env.RADAR_ALLOW_PRIVATE_HOSTS = "1"; // el portal ficticio corre en 127.0.0.1
process.env.RADAR_CHROMIUM_PATH = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
process.env.RADAR_WORKER_DISABLED = "1";
// NODE_ENV se pasa al invocar (NODE_ENV=test npx tsx …).

async function main() {
  const { prisma } = await import("../../lib/prisma");
  const { encryptSecret, decryptSecret } = await import("../../lib/ai/crypto");

  // Limpia restos de ejecuciones anteriores.
  const prev = await prisma.workspace.findUnique({ where: { slug: "carshop-e2e" } });
  if (prev) await prisma.workspace.delete({ where: { id: prev.id } });

  const ws = await prisma.workspace.create({
    data: { name: "Carshop E2E", slug: "carshop-e2e", settings: { modules: { radar: true }, whatsapp: { countryCode: "34" } } },
  });
  console.log("workspace", ws.id);

  await prisma.radarSource.create({
    data: {
      workspaceId: ws.id,
      portal: "testportal",
      enabled: true,
      usernameEnc: encryptSecret("comprador@carshop.test"),
      passwordEnc: encryptSecret("Clave.1234"),
      status: "pending",
    },
  });

  // Búsqueda 1: diésel baratos (debería casar BMW 118d y Renault Clio, no el Audi ni el Tesla).
  await prisma.radarSearch.create({
    data: { workspaceId: ws.id, name: "Diésel baratos", criteria: { fuels: ["diesel"], priceMax: 15000 } as any },
  });
  // Búsqueda 2: eléctricos (debería casar solo el Tesla).
  await prisma.radarSearch.create({
    data: { workspaceId: ws.id, name: "Eléctricos", criteria: { fuels: ["electrico"] } as any },
  });

  const { enqueueRun, executeRun } = await import("../../lib/radar/run");
  const { runId } = await enqueueRun(ws.id, "manual");
  assert.ok(runId, "debería crear un run");
  console.log("run", runId);
  await executeRun(runId!);

  const run = await prisma.radarRun.findUnique({ where: { id: runId! } });
  console.log("run status:", run?.status, "found:", run?.found, "new:", run?.newCount, "summary:", JSON.stringify(run?.summary));
  assert.equal(run?.status, "ok", "el run debería terminar OK");
  assert.equal(run?.found, 4, "debería encontrar 4 coches");
  assert.equal(run?.newCount, 4, "los 4 son nuevos");

  const source = await prisma.radarSource.findFirstOrThrow({ where: { workspaceId: ws.id } });
  assert.equal(source.status, "ok", "la fuente debería quedar OK");
  assert.ok(source.sessionEnc, "debería guardar la sesión (cookies) cifrada");
  assert.notEqual(source.passwordEnc, "Clave.1234", "la contraseña no se guarda en claro");
  assert.equal(decryptSecret(source.passwordEnc!), "Clave.1234", "la contraseña se descifra bien");

  const listings = await prisma.radarListing.findMany({ where: { workspaceId: ws.id }, orderBy: { externalId: "asc" } });
  console.log("listings:", listings.map((l) => `${l.externalId} ${l.make} ${l.model} ${l.km}km ${l.price}€ ${l.fuel} ${l.country}`));
  assert.equal(listings.length, 4);
  const bmw = listings.find((l) => l.externalId === "C-1001")!;
  assert.equal(bmw.make, "BMW");
  assert.equal(bmw.km, 82000);
  assert.equal(bmw.price, 14200);
  assert.equal(bmw.fuel, "diesel");
  assert.equal(bmw.year, 2019);
  assert.equal(bmw.url, `${BASE}/car/C-1001`);

  const diesel = await prisma.radarSearch.findFirstOrThrow({ where: { workspaceId: ws.id, name: "Diésel baratos" } });
  const electric = await prisma.radarSearch.findFirstOrThrow({ where: { workspaceId: ws.id, name: "Eléctricos" } });
  const dieselMatches = await prisma.radarMatch.findMany({ where: { searchId: diesel.id }, include: { listing: true } });
  const electricMatches = await prisma.radarMatch.findMany({ where: { searchId: electric.id }, include: { listing: true } });
  console.log("diésel baratos:", dieselMatches.map((m) => m.listing.externalId));
  console.log("eléctricos:", electricMatches.map((m) => m.listing.externalId));
  assert.deepEqual(dieselMatches.map((m) => m.listing.externalId).sort(), ["C-1001", "C-1003"], "diésel ≤15.000: BMW y Clio");
  assert.deepEqual(electricMatches.map((m) => m.listing.externalId).sort(), ["C-1004"], "eléctrico: Tesla");

  // Segunda revisión: nada nuevo (mismos coches), sin matches nuevos.
  const r2 = await enqueueRun(ws.id, "manual");
  await executeRun(r2.runId!);
  const run2 = await prisma.radarRun.findUnique({ where: { id: r2.runId! } });
  console.log("run2 found:", run2?.found, "new:", run2?.newCount);
  assert.equal(run2?.found, 4, "vuelve a ver 4");
  assert.equal(run2?.newCount, 0, "ninguno nuevo en la segunda pasada");

  const totalMatches = await prisma.radarMatch.count({ where: { workspaceId: ws.id } });
  assert.equal(totalMatches, 3, "no se duplican coincidencias (2 diésel + 1 eléctrico)");

  // Login incorrecto → login_failed, sin tumbar nada.
  await prisma.radarSource.update({ where: { id: source.id }, data: { passwordEnc: encryptSecret("mal"), sessionEnc: null, sessionSavedAt: null } });
  const r3 = await enqueueRun(ws.id, "manual");
  await executeRun(r3.runId!);
  const src3 = await prisma.radarSource.findUniqueOrThrow({ where: { id: source.id } });
  console.log("tras contraseña mala:", src3.status, src3.statusDetail);
  assert.equal(src3.status, "login_failed", "credenciales malas → login_failed");

  // H1: una revisión posterior NO debe reintentar un portal con login_failed
  // (evita bloquear la cuenta real del cliente). La fuente no se toca.
  const r4 = await enqueueRun(ws.id, "manual");
  await executeRun(r4.runId!);
  const run4 = await prisma.radarRun.findUnique({ where: { id: r4.runId! } });
  const src4 = await prisma.radarSource.findUniqueOrThrow({ where: { id: source.id } });
  const summary4 = (run4?.summary as Array<{ portal: string }>) ?? [];
  console.log("run4 summary:", JSON.stringify(summary4), "lastRunAt igual:", src4.lastRunAt?.getTime() === src3.lastRunAt?.getTime());
  assert.ok(!summary4.some((s) => s.portal === "testportal"), "una revisión normal NO reintenta el portal con login_failed");
  assert.equal(src4.lastRunAt?.getTime(), src3.lastRunAt?.getTime(), "no se vuelve a tocar el portal fallido");

  // Pero una PRUEBA explícita del portal sí lo reintenta (el usuario ha revisado
  // las credenciales). Con la contraseña aún mala, vuelve a fallar.
  const r5 = await enqueueRun(ws.id, "test", source.id);
  await executeRun(r5.runId!);
  const src5 = await prisma.radarSource.findUniqueOrThrow({ where: { id: source.id } });
  assert.ok((src5.lastRunAt?.getTime() ?? 0) > (src4.lastRunAt?.getTime() ?? 0), "la prueba explícita sí reintenta el portal");
  console.log("prueba explícita reintenta:", src5.status);

  await prisma.workspace.delete({ where: { id: ws.id } });
  await prisma.$disconnect();
  console.log("\nE2E OK ✅");
}

main().catch((e) => {
  console.error("E2E FALLÓ ❌", e);
  process.exit(1);
});
