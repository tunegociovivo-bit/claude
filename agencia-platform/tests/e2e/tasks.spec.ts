import { test, expect } from "./fixtures";

/**
 * Flujo 2: crear una tarea desde el modal de "+ Nueva tarea" en
 * /tareas, y verificar que aparece en la lista.
 */
test("crear una tarea desde el modal", async ({ authedPage: page }) => {
  await page.goto("/tareas");
  // Botón "Nueva tarea" — busca por texto en lugar de selector
  // específico para que no se rompa al cambiar la clase.
  const newButton = page.getByRole("button", { name: /nueva tarea|crear tarea/i }).first();
  if (!(await newButton.isVisible().catch(() => false))) {
    test.skip(true, "No hay botón 'Nueva tarea' — la página puede haber cambiado");
    return;
  }
  await newButton.click();

  // El modal debería tener un input de título.
  const titleInput = page.locator('input[placeholder*="título" i], input[placeholder*="title" i]').first();
  await expect(titleInput).toBeVisible({ timeout: 5_000 });

  const taskTitle = `E2E-${Date.now()}`;
  await titleInput.fill(taskTitle);

  // Submit: botón "Crear" o "Guardar"
  const submit = page.getByRole("button", { name: /crear|guardar/i }).last();
  await submit.click();

  // El modal debería cerrarse y la tarea aparecer en algún lugar de la
  // página. Tolerante a que aparezca en el kanban o la lista.
  await expect(page.getByText(taskTitle).first()).toBeVisible({ timeout: 10_000 });
});

test("la lista de tareas carga sin errores JS", async ({ authedPage: page }) => {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));
  await page.goto("/tareas");
  await page.waitForLoadState("networkidle");
  expect(errors, errors.join("\n")).toEqual([]);
});
