import { test, expect } from "./fixtures";

/**
 * Flujo 3: la página /mi-dia carga y muestra las secciones esperadas
 * sin que el server tire 500. Es la página por la que entran los
 * usuarios por la mañana; si rompe, perdemos retención.
 */
test("Mi día carga con las secciones principales", async ({ authedPage: page }) => {
  await page.goto("/mi-dia");
  await expect(page).toHaveURL(/\/mi-dia/);

  // El header tiene un saludo "Buenos días/tardes". Aceptamos cualquiera.
  await expect(page.getByText(/buenos d[ií]as|buenas tardes|buenas noches/i).first()).toBeVisible({
    timeout: 10_000
  });

  // Al menos alguna de las secciones característica debe aparecer.
  const sectionTitles = [/vencen hoy y mañana/i, /en review esperándote/i, /eventos de hoy/i, /notificaciones sin leer/i, /vencidas/i];
  const found = await Promise.race(
    sectionTitles.map(async (rx) => {
      try {
        await page.getByText(rx).first().waitFor({ timeout: 6_000 });
        return rx.source;
      } catch {
        return null;
      }
    })
  );
  expect(found, "ninguna sección de Mi día visible").not.toBeNull();
});

test("Cmd+K abre el palette global", async ({ authedPage: page }) => {
  await page.goto("/mi-dia");
  await page.waitForLoadState("networkidle");
  // El atajo Cmd+K (mac) y Ctrl+K (linux/windows) deberían funcionar.
  // En Playwright headless usamos Control.
  await page.keyboard.press("Control+K");
  // El palette tiene un input con placeholder "Buscar…"
  const search = page.locator('input[placeholder*="Buscar" i]').first();
  await expect(search).toBeVisible({ timeout: 3_000 });
});
