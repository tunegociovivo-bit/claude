/**
 * Tests de aislamiento multi-tenant.
 *
 * Premisa: dos workspaces totalmente separados (e2e y e2e2). El user
 * de uno NO debe poder LEER ni MUTAR ningún recurso del otro. La
 * respuesta esperada es 404 (no 403) para no filtrar la existencia
 * del id.
 *
 * Cómo se ejecutan:
 *   1) Levantar la app: npm run dev
 *   2) Seedear: npm run test:e2e:seed
 *   3) Correr: npm run test:e2e -- isolation
 *
 * Requiere:
 *   - El seed crea WS1 (slug "e2e") y WS2 (slug "e2e2"), cada uno
 *     con su user ADMIN y su proyecto/cliente/tarea exclusivo.
 *   - Los ids se descubren llamando al API; no se hardcodean para
 *     que el test sobreviva reseeds.
 */

import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const E2E_EMAIL = process.env.E2E_USER_EMAIL ?? "e2e@test.local";
const E2E_PASSWORD = process.env.E2E_USER_PASSWORD ?? "e2e-password-123";
const E2E_SLUG = process.env.E2E_WORKSPACE_SLUG ?? "e2e";
const E2E2_SLUG = process.env.E2E_WORKSPACE_SLUG_2 ?? "e2e2";

async function loginUI(page: import("@playwright/test").Page, email: string, password: string): Promise<boolean> {
  await page.goto("/login");
  const emailInput = page.locator('input[type="email"], input[name="email"]').first();
  if (!(await emailInput.isVisible().catch(() => false))) return false;
  await emailInput.fill(email);
  await page.locator('input[type="password"], input[name="password"]').first().fill(password);
  await page.locator('button[type="submit"]').first().click();
  try {
    await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Lee los ids del WS2 directamente desde la BD (saltándonos el API
 * porque precisamente queremos comprobar que el API NO los expone
 * cuando llamamos como WS1).
 */
async function readWs2Ids(): Promise<{ projectId: string; clientId: string; taskId: string } | null> {
  const ws2 = await prisma.workspace.findUnique({ where: { slug: E2E2_SLUG } });
  if (!ws2) return null;
  const project = await prisma.project.findFirst({
    where: { workspaceId: ws2.id, name: "E2E2 Proyecto Privado" }
  });
  const client = await prisma.client.findFirst({
    where: { workspaceId: ws2.id, name: "E2E2 Cliente Privado" }
  });
  const task = await prisma.task.findFirst({
    where: { workspaceId: ws2.id, title: "E2E2 Tarea Privada" }
  });
  if (!project || !client || !task) return null;
  return { projectId: project.id, clientId: client.id, taskId: task.id };
}

test.afterAll(async () => {
  await prisma.$disconnect();
});

test.describe("Aislamiento multi-tenant", () => {
  test("WS1 no puede leer un proyecto de WS2", async ({ page }) => {
    const ids = await readWs2Ids();
    test.skip(!ids, "Seed multi-tenant no disponible (¿ejecutaste test:e2e:seed?)");

    const loggedIn = await loginUI(page, E2E_EMAIL, E2E_PASSWORD);
    test.skip(!loggedIn, "Sin user E2E configurado");

    // La página de tareas asegura que estamos en WS1.
    await page.goto("/tareas");

    const res = await page.request.get(`/api/v1/projects/${ids!.projectId}`);
    expect(
      res.status(),
      "El API NO debe encontrar un proyecto de otro workspace"
    ).toBe(404);
  });

  test("WS1 no puede leer una tarea de WS2", async ({ page }) => {
    const ids = await readWs2Ids();
    test.skip(!ids, "Seed multi-tenant no disponible");

    const loggedIn = await loginUI(page, E2E_EMAIL, E2E_PASSWORD);
    test.skip(!loggedIn, "Sin user E2E configurado");

    const res = await page.request.get(`/api/v1/tasks/${ids!.taskId}`);
    expect(res.status()).toBe(404);
  });

  test("WS1 no puede leer un cliente de WS2", async ({ page }) => {
    const ids = await readWs2Ids();
    test.skip(!ids, "Seed multi-tenant no disponible");

    const loggedIn = await loginUI(page, E2E_EMAIL, E2E_PASSWORD);
    test.skip(!loggedIn, "Sin user E2E configurado");

    const res = await page.request.get(`/api/v1/clients/${ids!.clientId}`);
    expect(res.status()).toBe(404);
  });

  test("WS1 no puede borrar un proyecto de WS2", async ({ page }) => {
    const ids = await readWs2Ids();
    test.skip(!ids, "Seed multi-tenant no disponible");

    const loggedIn = await loginUI(page, E2E_EMAIL, E2E_PASSWORD);
    test.skip(!loggedIn, "Sin user E2E configurado");

    const res = await page.request.delete(
      `/api/v1/projects/${ids!.projectId}?confirm=${ids!.projectId}`
    );
    expect(res.status()).toBe(404);

    // Verificación cruzada: el proyecto sigue vivo en BD.
    const stillExists = await prisma.project.findUnique({
      where: { id: ids!.projectId }
    });
    expect(stillExists, "El proyecto de WS2 no debe haberse tocado").toBeTruthy();
    expect(stillExists?.deletedAt).toBeNull();
  });

  test("WS1 no puede mover tareas a un proyecto destino de WS2", async ({ page }) => {
    const ids = await readWs2Ids();
    test.skip(!ids, "Seed multi-tenant no disponible");

    const loggedIn = await loginUI(page, E2E_EMAIL, E2E_PASSWORD);
    test.skip(!loggedIn, "Sin user E2E configurado");

    // Necesitamos un proyecto válido de WS1 como origen — leemos
    // cualquier proyecto vivo del WS del user.
    const me = await page.request.get("/api/v1/me");
    const meJson = await me.json();
    const ws1 = await prisma.workspace.findUnique({ where: { slug: E2E_SLUG } });
    const proj1 = await prisma.project.findFirst({
      where: { workspaceId: ws1!.id, deletedAt: null }
    });
    test.skip(!proj1, "El seed WS1 no creó un proyecto");

    const res = await page.request.post(
      `/api/v1/projects/${proj1!.id}/move-tasks`,
      { data: { destinationProjectId: ids!.projectId } }
    );
    // El endpoint debe responder 404 destination_not_found porque
    // filtra por workspaceId — el proyecto de WS2 no existe para WS1.
    expect(res.status()).toBe(404);
  });
});
