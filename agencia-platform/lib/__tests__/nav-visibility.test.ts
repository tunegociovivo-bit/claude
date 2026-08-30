/**
 * Descubribilidad: los accesos a los paneles nuevos deben existir en la navegación y en el
 * catálogo admin, con nombres legibles y permiso admin donde corresponde. Guarda contra
 * regresiones que dejen las pantallas "existentes pero inalcanzables".
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { ADMIN_CARDS } from "../admin-catalog";

const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

describe("catálogo admin — herramientas visibles con nombre legible", () => {
  const byHref = (href: string) => ADMIN_CARDS.find((c) => c.href === href);
  it("Autonomía de Sonia aparece (admin)", () => {
    const c = byHref("/admin/sonia-autonomia");
    expect(c).toBeTruthy();
    expect(c!.title).toMatch(/autonom/i);
    expect(c!.adminOnly).toBe(true);
  });
  it("Facturas recurrentes aparece (admin)", () => {
    const c = byHref("/admin/facturacion-recurrentes");
    expect(c).toBeTruthy();
    expect(c!.title).toMatch(/recurrent/i);
    expect(c!.adminOnly).toBe(true);
  });
});

describe("Sidebar — enlaces visibles añadidos", () => {
  const src = read("components/Sidebar.tsx");
  it("enlaza Facturas recurrentes y Remesas SEPA bajo Facturación", () => {
    expect(src).toContain("/admin/facturacion-recurrentes");
    expect(src).toContain("Facturas recurrentes");
    expect(src).toContain("/facturacion/remesas");
    expect(src).toContain("Remesas SEPA");
  });
  it("enlaza Autonomía de Sonia (bajo guard admin)", () => {
    expect(src).toContain("/admin/sonia-autonomia");
    expect(src).toContain("Autonomía de Sonia");
    // el enlace de autonomía va dentro de un guard de rol ADMIN
    expect(src).toMatch(/role === "ADMIN"[\s\S]*sonia-autonomia/);
  });
});

describe("/facturacion — tarjeta de recurrentes con datos reales (no hardcode)", () => {
  const src = read("app/facturacion/page.tsx");
  it("cuenta todas las recurrencias y muestra sus próximas entregas", () => {
    expect(src).toContain("listRecurringTemplates(workspaceId)");
    expect(src).toContain("upcomingRecurringDeliveries(recurringTemplates, 3)");
    expect(src).toContain("recImported");
    expect(src).toContain("recActive");
    expect(src).toContain("recPaused");
    expect(src).toContain("/admin/facturacion-recurrentes");
    expect(src).toContain("Para: {delivery.recipient}");
    expect(src).toContain("BCC: {delivery.bcc}");
    // no hardcode de los números del ejemplo
    expect(src).not.toMatch(/20 importadas/);
  });
});

describe("/tareas — bloque Sonia status con enlace al panel", () => {
  const src = read("app/tareas/TareasClient.tsx");
  it("incluye 'Panel de autonomía' → /admin/sonia-autonomia", () => {
    expect(src).toContain("Panel de autonomía");
    expect(src).toContain("/admin/sonia-autonomia");
  });
});
