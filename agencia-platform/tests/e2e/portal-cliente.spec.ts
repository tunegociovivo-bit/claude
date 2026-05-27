import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

/**
 * Flujo 5: portal público del cliente. NO requiere login — solo
 * un token válido. Recupera el último ClientApprovalLink del
 * workspace de pruebas y verifica que la página carga sin errores
 * JS y muestra el nombre del cliente.
 *
 * Si no hay link, se skipea (necesita seed). El test usa Prisma
 * directamente porque la API no expone los tokens (privacy).
 */
test("el portal /p/cliente/[token] carga datos del cliente", async ({ page }) => {
  const prisma = new PrismaClient();
  try {
    const slug = process.env.E2E_WORKSPACE_SLUG ?? "e2e";
    const ws = await prisma.workspace.findUnique({ where: { slug } });
    if (!ws) {
      test.skip(true, "Workspace E2E no encontrado: ejecuta npm run test:e2e:seed");
      return;
    }
    const link = await prisma.clientApprovalLink.findFirst({
      where: { workspaceId: ws.id, revokedAt: null },
      orderBy: { createdAt: "desc" }
    });
    if (!link) {
      test.skip(true, "Sin approval link en el workspace E2E");
      return;
    }

    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));

    await page.goto(`/p/cliente/${link.token}`);
    await expect(page).toHaveURL(new RegExp(`/p/cliente/${link.token}`));

    // El header del portal pinta el nombre del cliente. Esperamos
    // hasta 10s a que aparezca (el page client-fetch tarda).
    await expect(page.getByText(/E2E Cliente/i).first()).toBeVisible({ timeout: 10_000 });
    expect(errors, errors.join("\n")).toEqual([]);
  } finally {
    await prisma.$disconnect();
  }
});
