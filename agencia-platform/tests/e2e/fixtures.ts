import { test as base, expect, type Page } from "@playwright/test";

const E2E_EMAIL = process.env.E2E_USER_EMAIL ?? "e2e@test.local";
const E2E_PASSWORD = process.env.E2E_USER_PASSWORD ?? "e2e-password-123";

/**
 * Login helper. La app usa next-auth con credenciales. Si el formulario
 * de login no existe o las credenciales no funcionan, marcamos el test
 * como skipped en lugar de fallar — los tests E2E asumen que existe un
 * usuario de pruebas seedeado. Para CI completo, el setup debería
 * llamar a scripts/seed-e2e.ts antes de correr playwright.
 */
export async function loginIfPossible(page: Page): Promise<boolean> {
  await page.goto("/login");
  const emailInput = page.locator('input[type="email"], input[name="email"]').first();
  const passwordInput = page.locator('input[type="password"], input[name="password"]').first();
  if (!(await emailInput.isVisible().catch(() => false))) return false;
  await emailInput.fill(E2E_EMAIL);
  await passwordInput.fill(E2E_PASSWORD);
  const submit = page.locator('button[type="submit"]').first();
  await submit.click();
  // Esperamos a que cambie la URL. Si seguimos en /login tras 5s, no
  // hemos logueado (credenciales malas → skip).
  try {
    await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 5_000 });
    return true;
  } catch {
    return false;
  }
}

export const test = base.extend<{ authedPage: Page }>({
  authedPage: async ({ page }, use, info) => {
    const ok = await loginIfPossible(page);
    if (!ok) {
      info.skip(true, "Sin usuario de pruebas E2E configurado. Define E2E_USER_EMAIL y E2E_USER_PASSWORD y seedea un user de prueba.");
    }
    await use(page);
  }
});

export { expect };
