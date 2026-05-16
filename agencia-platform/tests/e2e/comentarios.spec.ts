import { test, expect } from "./fixtures";

/**
 * Flujo 6: comentar una tarea con el editor rich. Asume seed:
 * abrir la primera tarea del usuario E2E desde /tareas, escribir
 * un comentario y comprobar que aparece en el hilo.
 *
 * Si el seed no se ha ejecutado o no hay tareas visibles, skipea.
 */
test("comentar una tarea desde el modal", async ({ authedPage: page }) => {
  await page.goto("/tareas");
  // Esperar a que cargue la lista (en mobile entra como list view)
  await page.waitForLoadState("networkidle");

  // Click en cualquier tarea visible que coincida con el seed.
  const card = page.getByText(/E2E Tarea de muestra/i).first();
  if (!(await card.isVisible({ timeout: 4_000 }).catch(() => false))) {
    test.skip(true, "No hay tarea seedeada visible. Ejecuta npm run test:e2e:seed");
    return;
  }
  await card.click();

  // Modal abierto: el editor de comentarios está al final. Buscamos
  // el contenteditable (TipTap) y escribimos.
  const editor = page.locator(".ProseMirror").first();
  await expect(editor).toBeVisible({ timeout: 6_000 });
  const body = `E2E comment ${Date.now()}`;
  await editor.click();
  await editor.fill(""); // por si quedaba algo
  await page.keyboard.type(body);

  // Pulsar "Enviar"
  await page.getByRole("button", { name: /enviar/i }).first().click();

  // El comentario debería aparecer en el hilo de la propia modal.
  await expect(page.getByText(body).first()).toBeVisible({ timeout: 10_000 });
});
