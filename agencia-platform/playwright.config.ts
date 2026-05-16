import { defineConfig, devices } from "@playwright/test";

/**
 * Tests E2E críticos del Hub. Cubrimos los flujos que rompen el
 * trabajo diario si dejan de funcionar:
 *   1. Login + dashboard
 *   2. Crear tarea desde el modal
 *   3. Comentar en una tarea
 *
 * Configuración: assume que la app está corriendo en localhost:3000
 * con la BD de desarrollo y un usuario de pruebas creado (definido
 * por env vars E2E_USER_EMAIL / E2E_USER_PASSWORD). Si la BD está
 * vacía y no hay user de pruebas, los tests se skipean en lugar de
 * fallar — para no bloquear CI cuando solo se prueba código que no
 * toca rutas autenticadas.
 *
 * Variables de entorno:
 *   E2E_BASE_URL      (default: http://localhost:3000)
 *   E2E_USER_EMAIL    (default: e2e@test.local)
 *   E2E_USER_PASSWORD (default: e2e-password-123)
 *
 * Cómo ejecutar:
 *   npm run test:e2e:install   # 1ª vez instala chromium
 *   npm run test:e2e           # corre todos
 *   npm run test:e2e:ui        # UI interactiva
 */
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false, // los tests comparten BD y un user, evitamos races
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? "github" : "list",
  timeout: 30_000,
  expect: { timeout: 5_000 },
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    locale: "es-ES",
    viewport: { width: 1280, height: 800 }
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] }
    }
  ]
});
