/**
 * Recuperación de tareas borradas en masa (Hub Negocio Vivo).
 *
 * El borrado en masa de tareas hacía un borrado FÍSICO (sin papelera) que
 * además NO limpiaba la tabla `SearchEmbedding` — donde se guarda el
 * TÍTULO + DESCRIPCIÓN de cada tarea para la búsqueda semántica. Por eso el
 * contenido de las tareas borradas sigue ahí y se puede recuperar.
 *
 * Recupera TÍTULO + DESCRIPCIÓN. NO recupera columna/fecha/responsables ni la
 * relación padre-subtarea (eso solo está en una copia de seguridad de la BD).
 *
 * USO (con la DATABASE_URL de PRODUCCIÓN en el entorno):
 *
 *   # 1) Listar las tareas borradas recuperables (solo lectura):
 *   npx tsx scripts/recover-deleted-tasks.ts
 *
 *   # 2) Recuperar tareas concretas re-creándolas en un proyecto/columna:
 *   npx tsx scripts/recover-deleted-tasks.ts \
 *     --restore \
 *     --project <PROJECT_ID> \
 *     --status "REUNIONES Y LLAMADAS" \
 *     --ids id1,id2,id3
 *
 *   # (--project "auto" busca un proyecto cuyo nombre contenga "negocio vivo")
 *
 * Las tareas recuperadas se crean con el prefijo "[RECUPERADA] " en el título
 * para que las reconozcas; quítalo cuando confirmes que están bien.
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

/** Separa el texto indexado en título (antes del primer \n\n) y descripción. */
function splitText(text: string): { title: string; description: string } {
  const sep = text.indexOf("\n\n");
  if (sep === -1) return { title: text.trim(), description: "" };
  return {
    title: text.slice(0, sep).trim(),
    description: text.slice(sep + 2).trim()
  };
}

/** Embeddings de tipo TASK cuya tarea ya no existe → tareas borradas. */
async function findOrphans() {
  const embeddings = await prisma.searchEmbedding.findMany({
    where: { entityType: "TASK" },
    select: { entityId: true, workspaceId: true, text: true, createdAt: true, updatedAt: true },
    orderBy: { updatedAt: "desc" }
  });
  if (embeddings.length === 0) return [];
  const ids = embeddings.map((e) => e.entityId);
  const alive = await prisma.task.findMany({
    where: { id: { in: ids } },
    select: { id: true }
  });
  const aliveSet = new Set(alive.map((t) => t.id));
  return embeddings.filter((e) => !aliveSet.has(e.entityId));
}

async function list() {
  const orphans = await findOrphans();
  if (orphans.length === 0) {
    console.log("No hay tareas borradas recuperables en el índice. (Nada que recuperar.)");
    return;
  }
  console.log(`\n${orphans.length} tarea(s) borrada(s) recuperable(s):\n`);
  for (const o of orphans) {
    const { title, description } = splitText(o.text);
    console.log("──────────────────────────────────────────────");
    console.log(`id:        ${o.entityId}`);
    console.log(`título:    ${title}`);
    if (description) {
      console.log(`descripción: ${description.slice(0, 300)}${description.length > 300 ? "…" : ""}`);
    }
    console.log(`indexada:  ${o.createdAt.toISOString()}  ·  última edición: ${o.updatedAt.toISOString()}`);
  }
  console.log("\nPara recuperarlas, vuelve a ejecutar con --restore (ver cabecera del script).");
}

async function restore() {
  const status = arg("status");
  let projectArg = arg("project");
  const idsArg = arg("ids");
  if (!status) throw new Error('Falta --status "NOMBRE DE LA COLUMNA"');
  if (!projectArg) throw new Error("Falta --project <PROJECT_ID> (o --project auto)");
  if (!idsArg) throw new Error("Falta --ids id1,id2,... (cópialos del listado)");

  const wantedIds = idsArg.split(",").map((s) => s.trim()).filter(Boolean);

  // Resolver el proyecto destino.
  let project;
  if (projectArg === "auto") {
    project = await prisma.project.findFirst({
      where: { name: { contains: "negocio vivo", mode: "insensitive" } },
      select: { id: true, name: true, clientId: true, workspaceId: true }
    });
    if (!project) throw new Error("No encontré un proyecto cuyo nombre contenga 'negocio vivo'. Pasa --project <id>.");
    console.log(`Proyecto destino: ${project.name} (${project.id})`);
  } else {
    project = await prisma.project.findUnique({
      where: { id: projectArg },
      select: { id: true, name: true, clientId: true, workspaceId: true }
    });
    if (!project) throw new Error(`No existe el proyecto ${projectArg}`);
  }

  const orphans = await findOrphans();
  const byId = new Map(orphans.map((o) => [o.entityId, o]));

  let created = 0;
  for (const id of wantedIds) {
    const o = byId.get(id);
    if (!o) {
      console.warn(`  ⚠️  ${id}: no está entre las recuperables (¿ya existe o id incorrecto?). Saltada.`);
      continue;
    }
    if (o.workspaceId !== project.workspaceId) {
      console.warn(`  ⚠️  ${id}: pertenece a otro workspace que el proyecto destino. Saltada.`);
      continue;
    }
    const { title, description } = splitText(o.text);
    await prisma.task.create({
      data: {
        workspaceId: project.workspaceId,
        projectId: project.id,
        clientId: project.clientId ?? null,
        title: `[RECUPERADA] ${title}`,
        description: description || null,
        status
      }
    });
    created++;
    console.log(`  ✅ recuperada: ${title}`);
  }
  console.log(`\n${created} tarea(s) recuperada(s) en "${project.name}" → columna "${status}".`);
  console.log('Revisa el tablero, recoloca/edita lo que haga falta y quita el prefijo "[RECUPERADA] ".');
}

async function main() {
  if (flag("restore")) {
    await restore();
  } else {
    await list();
  }
}

main()
  .catch((e) => {
    console.error("Error:", e.message ?? e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
