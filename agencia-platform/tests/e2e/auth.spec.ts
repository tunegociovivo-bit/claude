import { test, expect, loginIfPossible } from "./fixtures";

/**
 * Flujo 1: login con credenciales y aterrizar en una página
 * autenticada del Hub. Verifica que el flujo de credenciales sigue
 * funcionando — si esto se rompe nadie puede entrar.
 */
test("login lleva a una página autenticada", async ({ page }) => {
  const ok = await loginIfPossible(page);
  test.skip(!ok, "Sin usuario de pruebas E2E configurado");

  // Tras login, esperamos algo del shell autenticado (sidebar, top bar).
  // No nos casamos con una URL concreta porque puede variar según
  // permisos del user (un user sin /tareas iría a Mi día, etc).
  await expect(page.locator("nav, aside").first()).toBeVisible({ timeout: 10_000 });
});

test("la página de login carga sin errores", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));
  await page.goto("/login");
  await expect(page).toHaveURL(/\/login/);
  expect(errors).toEqual([]);
});
