#!/usr/bin/env node
/**
 * Detector de IDOR multi-tenant.
 *
 * Recorre app/api e informa de cada `prisma.X.update/delete({ where: { id } })`
 * (sin workspaceId en el where) cuyo handler NO haya comprobado antes la
 * pertenencia al workspace (findFirst/updateMany/deleteMany con workspaceId,
 * o un helper get*(api.workspaceId, ...)).
 *
 * Es el patrón que causó los IDOR reales de admin/ai-agent/proposed-tools y
 * admin/ai-agent/pricing: update({ where: { id: params.id } }) a pelo.
 *
 * Uso:  node scripts/check-tenant-guards.mjs        → lista y exit 1 si hay
 *       npm run lint:tenant
 *
 * Heurística por handler (los `export const GET/POST/... =` de cada route.ts):
 * un escrito sin workspaceId en su where solo es sospechoso si ANTES, en el
 * mismo handler, no aparece ninguna referencia a workspaceId (guard). Falsos
 * positivos posibles → añade el fichero a ALLOWLIST con el motivo.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const API_DIR = join(ROOT, "app", "api");

// Rutas donde el patrón es correcto a propósito (explica el motivo).
const ALLOWLIST = new Map([
  [
    "app/api/public/credentials/[token]/route.ts",
    "acceso por token de un solo uso: el grant se busca por token, no por sesión"
  ]
]);

// Modelos sin columna workspaceId (globales o anidados bajo un padre que ya
// se valida). Se autodetectan del schema.prisma.
const schema = readFileSync(join(ROOT, "prisma", "schema.prisma"), "utf8");
const tenantModels = new Set();
for (const m of schema.matchAll(/model\s+(\w+)\s*\{([\s\S]*?)\n\}/g)) {
  if (/^\s*workspaceId\s/m.test(m[2])) {
    tenantModels.add(m[1][0].toLowerCase() + m[1].slice(1));
  }
}

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (name === "route.ts") yield p;
  }
}

const findings = [];
for (const file of walk(API_DIR)) {
  const rel = relative(ROOT, file);
  if (ALLOWLIST.has(rel)) continue;
  const src = readFileSync(file, "utf8");
  // Los crons protegidos por CRON_SECRET operan sobre TODOS los workspaces
  // a propósito (watchdogs, ticks); no aplica el guard por tenant.
  if (rel.startsWith("app/api/cron/") && src.includes("CRON_SECRET")) continue;

  // Extrae el objeto `where: { ... }` completo balanceando llaves (puede
  // anidar, p.ej. { id: { in: ids }, workspaceId }).
  function whereBodyAt(text, from) {
    const m = /where:\s*\{/.exec(text.slice(from, from + 400));
    if (!m) return null;
    let i = from + m.index + m[0].length;
    let depth = 1;
    const start = i;
    while (i < text.length && depth > 0) {
      if (text[i] === "{") depth++;
      else if (text[i] === "}") depth--;
      i++;
    }
    return text.slice(start, i - 1);
  }

  // Trocea por handlers exportados; lo anterior al primer export es común.
  const parts = src.split(/(?=export\s+(?:const|async\s+function)\s+(?:GET|POST|PUT|PATCH|DELETE))/);
  for (const part of parts) {
    // Busca prisma.<modelo>.update|delete( y analiza su where completo.
    for (const call of part.matchAll(/prisma\.(\w+)\.(update|delete|updateMany|deleteMany)\(/g)) {
      const [, model, op] = call;
      if (!tenantModels.has(model)) continue; // modelo sin workspaceId
      const whereBody = whereBodyAt(part, call.index + call[0].length);
      // workspaceId filtra por tenant; userId vale para recursos personales
      // (calendarios, notificaciones) que se poseen por usuario.
      if (whereBody == null || /workspaceId|userId/.test(whereBody)) continue;
      // ¿Hay guard de workspace ANTES de esta llamada en el mismo handler?
      const before = part.slice(0, call.index);
      const guarded =
        /workspaceId/.test(before) || // findFirst/getOwned/etc. con workspaceId
        /await\s+get\w*Owned?\(/.test(before);
      if (guarded) continue;
      const line = src.slice(0, src.indexOf(part) + call.index).split("\n").length;
      findings.push(`${rel}:${line}  prisma.${model}.${op} sin guard de workspace en el handler`);
    }
  }
}

if (findings.length) {
  console.error("⛔ Posibles IDOR multi-tenant (escritura sin guard de workspace):\n");
  for (const f of findings) console.error("  " + f);
  console.error(
    `\n${findings.length} hallazgo(s). Añade workspaceId al where (o un findFirst con` +
      " workspaceId antes), o documenta la excepción en ALLOWLIST del script."
  );
  process.exit(1);
}
console.log(`✓ Sin escrituras sin guard de workspace (${tenantModels.size} modelos multi-tenant).`);
