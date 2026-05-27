/**
 * scripts/seed-e2e.ts
 *
 * Crea (o resetea) los datos mínimos que los tests E2E necesitan:
 *   - Un workspace de pruebas con slug "e2e".
 *   - Un user "e2e@test.local" con password "e2e-password-123",
 *     rol ADMIN del workspace.
 *   - Un cliente, un proyecto, una tarea ligada al proyecto.
 *   - Un link de aprobación editorial vacío del cliente (para
 *     tests del portal público).
 *
 * Idempotente: si ya existen los registros, los actualiza al
 * estado canónico. Seguro de ejecutar contra una BD con datos
 * reales mientras nadie esté usando el workspace "e2e".
 *
 * Uso:
 *   npx tsx scripts/seed-e2e.ts
 *
 * Variables de entorno opcionales (para alinearse con E2E):
 *   E2E_USER_EMAIL     (default: "e2e@test.local")
 *   E2E_USER_PASSWORD  (default: "e2e-password-123")
 *   E2E_WORKSPACE_SLUG (default: "e2e")
 */

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const EMAIL = process.env.E2E_USER_EMAIL ?? "e2e@test.local";
const PASSWORD = process.env.E2E_USER_PASSWORD ?? "e2e-password-123";
const SLUG = process.env.E2E_WORKSPACE_SLUG ?? "e2e";

async function main() {
  console.log(`[seed-e2e] workspace=${SLUG} user=${EMAIL}`);

  const ws = await prisma.workspace.upsert({
    where: { slug: SLUG },
    update: { name: "E2E Workspace" },
    create: { slug: SLUG, name: "E2E Workspace" }
  });

  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const user = await prisma.user.upsert({
    where: { email: EMAIL },
    update: { passwordHash, name: "E2E Tester" },
    create: { email: EMAIL, name: "E2E Tester", passwordHash, role: "ADMIN" }
  });

  await prisma.membership.upsert({
    where: { workspaceId_userId: { workspaceId: ws.id, userId: user.id } },
    update: { role: "ADMIN" },
    create: { workspaceId: ws.id, userId: user.id, role: "ADMIN" }
  });

  // Cliente, proyecto, tarea
  let client = await prisma.client.findFirst({
    where: { workspaceId: ws.id, name: "E2E Cliente" }
  });
  if (!client) {
    client = await prisma.client.create({
      data: {
        workspaceId: ws.id,
        name: "E2E Cliente",
        industry: "Pruebas automáticas",
        contactName: "QA Bot"
      }
    });
  }

  let project = await prisma.project.findFirst({
    where: { workspaceId: ws.id, name: "E2E Proyecto" }
  });
  if (!project) {
    project = await prisma.project.create({
      data: { workspaceId: ws.id, clientId: client.id, name: "E2E Proyecto", description: "Para tests" }
    });
  }

  const taskExists = await prisma.task.findFirst({
    where: { workspaceId: ws.id, title: "E2E Tarea de muestra" }
  });
  if (!taskExists) {
    await prisma.task.create({
      data: {
        workspaceId: ws.id,
        projectId: project.id,
        clientId: client.id,
        title: "E2E Tarea de muestra",
        description: "Tarea creada por scripts/seed-e2e.ts",
        status: "TODO",
        priority: "MEDIUM"
      } as any
    });
  }

  // Link de aprobación editorial — útil para probar /p/cliente/[token]
  // y /p/editorial/[token] sin tener que crearlo a mano.
  const month = new Date().toISOString().slice(0, 7); // YYYY-MM
  let link = await prisma.clientApprovalLink.findFirst({
    where: { workspaceId: ws.id, clientId: client.id, month }
  });
  if (!link) {
    link = await prisma.clientApprovalLink.create({
      data: {
        workspaceId: ws.id,
        clientId: client.id,
        month,
        token: `e2e-${Date.now().toString(36)}`,
        expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000)
      }
    });
  }

  console.log(`[seed-e2e] OK — workspace=${ws.id}, user=${user.id}, client=${client.id}, project=${project.id}`);
  console.log(`[seed-e2e] approval link público en: /p/cliente/${link.token}  /p/editorial/${link.token}`);

  // ──────────────────────────────────────────────────────────────
  // Segundo workspace + user totalmente aislado, para tests de
  // multi-tenancy. El test verifica que e2e2 NO puede acceder a
  // recursos de e2e (404, no 403 — para no filtrar la existencia).
  // ──────────────────────────────────────────────────────────────
  const SLUG_2 = process.env.E2E_WORKSPACE_SLUG_2 ?? "e2e2";
  const EMAIL_2 = process.env.E2E_USER_EMAIL_2 ?? "e2e2@test.local";
  const PASSWORD_2 = process.env.E2E_USER_PASSWORD_2 ?? "e2e2-password-456";

  const ws2 = await prisma.workspace.upsert({
    where: { slug: SLUG_2 },
    update: { name: "E2E Workspace 2" },
    create: { slug: SLUG_2, name: "E2E Workspace 2" }
  });
  const passwordHash2 = await bcrypt.hash(PASSWORD_2, 10);
  const user2 = await prisma.user.upsert({
    where: { email: EMAIL_2 },
    update: { passwordHash: passwordHash2, name: "E2E Tester 2" },
    create: { email: EMAIL_2, name: "E2E Tester 2", passwordHash: passwordHash2, role: "ADMIN" }
  });
  await prisma.membership.upsert({
    where: { workspaceId_userId: { workspaceId: ws2.id, userId: user2.id } },
    update: { role: "ADMIN" },
    create: { workspaceId: ws2.id, userId: user2.id, role: "ADMIN" }
  });

  // Recursos exclusivos del WS2 — los tests de aislamiento intentan
  // leerlos desde el WS1 y deben recibir 404.
  let client2 = await prisma.client.findFirst({
    where: { workspaceId: ws2.id, name: "E2E2 Cliente Privado" }
  });
  if (!client2) {
    client2 = await prisma.client.create({
      data: {
        workspaceId: ws2.id,
        name: "E2E2 Cliente Privado",
        industry: "Aislamiento",
        contactName: "Solo WS2"
      }
    });
  }
  let project2 = await prisma.project.findFirst({
    where: { workspaceId: ws2.id, name: "E2E2 Proyecto Privado" }
  });
  if (!project2) {
    project2 = await prisma.project.create({
      data: { workspaceId: ws2.id, clientId: client2.id, name: "E2E2 Proyecto Privado" }
    });
  }
  const task2Exists = await prisma.task.findFirst({
    where: { workspaceId: ws2.id, title: "E2E2 Tarea Privada" }
  });
  if (!task2Exists) {
    await prisma.task.create({
      data: {
        workspaceId: ws2.id,
        projectId: project2.id,
        clientId: client2.id,
        title: "E2E2 Tarea Privada",
        status: "TODO",
        priority: "MEDIUM"
      } as any
    });
  }

  console.log(`[seed-e2e] WS2 — workspace=${ws2.id}, user=${user2.id}, project=${project2.id}, client=${client2.id}`);
}

main()
  .catch((e) => {
    console.error("[seed-e2e] error:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
