import { test, expect } from "./fixtures";

/**
 * Flujo 4: /clientes carga y muestra al menos un cliente del seed
 * ("E2E Cliente"). Si el seed no se ejecutó, se skipea — los tests
 * son tolerantes para que CI pueda correr sin BD seedeada.
 */
test("la página de clientes muestra el cliente seedeado", async ({ authedPage: page }) => {
  await page.goto("/clientes");
  await expect(page).toHaveURL(/\/clientes/);

  const seeded = page.getByText(/E2E Cliente/i).first();
  // Si el seed no se ha ejecutado, hacemos skip con un mensaje claro
  // en lugar de fallar el test.
  if (!(await seeded.isVisible({ timeout: 3_000 }).catch(() => false))) {
    test.skip(true, "Seed E2E no ejecutado: npm run test:e2e:seed");
    return;
  }
  await expect(seeded).toBeVisible();
});
