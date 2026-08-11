/**
 * FASE 2 · objetivo 9 — Benchmark verificable (sin BD, sin PII).
 *
 * Compara el tamaño de payload del listado de clientes PESADO (objeto Client
 * completo, como /api/v1/clients) frente al MÍNIMO del buscador nuevo
 * (/api/v1/clients/search → {id,name,status}). Usa datos SINTÉTICOS: no toca la
 * base de datos ni expone información real.
 *
 *   npx tsx scripts/bench-client-payload.ts
 *   N=1000 npx tsx scripts/bench-client-payload.ts
 */

const N = Number(process.env.N ?? "500");

// Forma aproximada de un Client completo (los campos que hoy devuelve
// /api/v1/clients). Valores sintéticos representativos.
function fullClient(i: number) {
  return {
    id: `clxxxxxxxxxxxxxxxxxxxx${i}`,
    workspaceId: "wkxxxxxxxxxxxxxxxxxxxx",
    name: `Cliente sintético número ${i}`,
    industry: "Hostelería",
    contactName: "Nombre Apellido",
    email: `contacto${i}@ejemplo.test`,
    phone: "+34600000000",
    status: i % 3 === 0 ? "PAUSED" : "ACTIVE",
    mrr: 199.99,
    since: "2024-01-01",
    notes: "Notas internas de ejemplo con algo de longitud para ser realista.",
    prioridad: "NORMAL",
    servicios: ["seo", "ads", "social"],
    kitDigital: true,
    legalName: "Razón Social Sintética SL",
    taxId: "B00000000",
    fiscalAddress: "Calle Falsa 123, 3º B",
    postalCode: "29000",
    city: "Ciudad",
    province: "Provincia",
    countryCode: "ES",
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-06-01T00:00:00.000Z",
    deletedAt: null
  };
}

function minimalClient(i: number) {
  const f = fullClient(i);
  return { id: f.id, name: f.name, status: f.status };
}

const full = JSON.stringify({ items: Array.from({ length: N }, (_, i) => fullClient(i)), total: N });
const minimalFirstPage = JSON.stringify({
  items: Array.from({ length: Math.min(20, N) }, (_, i) => minimalClient(i)),
  nextCursor: N > 20 ? "clxxxxxxxxxxxxxxxxxxxx19" : null
});

const fullBytes = Buffer.byteLength(full, "utf8");
const minimalBytes = Buffer.byteLength(minimalFirstPage, "utf8");

console.log("── Benchmark payload clientes (sintético, sin BD) ──");
console.log(`Clientes simulados: ${N}`);
console.log(`/api/v1/clients (objeto completo, ${N} filas):   ${fullBytes.toLocaleString()} bytes`);
console.log(`/api/v1/clients/search (mínimo, 1ª pág. 20 filas): ${minimalBytes.toLocaleString()} bytes`);
const ratio = fullBytes / minimalBytes;
console.log(`Reducción de payload en la primera carga del combobox: ${ratio.toFixed(1)}× más ligero`);
console.log("");
console.log("Nota: además, el buscador pagina por cursor (limit+1) → coste O(limit),");
console.log("no O(total), frente a cargar los ~500 clientes de golpe en cada dropdown.");
