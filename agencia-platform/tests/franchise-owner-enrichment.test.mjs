import assert from "node:assert/strict";
import test from "node:test";
import { normalizeOwnerResearch } from "../lib/leads/franchise-owner-enrichment.ts";

test("rejects central contact details as local owner evidence", () => {
  const out = normalizeOwnerResearch({
    classification: "franchise",
    operatorName: "Alcampo S.A.",
    operatorWebsite: "https://alcampo.es/tiendas/madrid",
    ownerName: "Director nacional",
    emails: ["contacto@alcampo.es"],
    sources: [{ url: "https://alcampo.es", title: "Alcampo" }],
  }, "Alcampo", "alcampo.es");

  assert.equal(out.classification, "unconfirmed");
  assert.equal(out.operatorName, null);
  assert.deepEqual(out.emails, []);
  assert.equal(out.confidence, "low");
});

test("keeps a separately evidenced local operating company", () => {
  const out = normalizeOwnerResearch({
    classification: "franchise",
    operatorName: "Supermercados Villa SL",
    taxId: "B12345678",
    ownerName: "Ana Villa Pérez",
    ownerRole: "Administradora única",
    operatorWebsite: "https://supermercadosvilla.es",
    emails: ["gerencia@supermercadosvilla.es", "GERENCIA@SUPERMERCADOSVILLA.ES"],
    sources: [
      { url: "https://alcampocorporativo.es/apertura-villalbilla", title: "Apertura" },
      { url: "https://www.boe.es/borme/dias/2025/01/01/", title: "BORME" },
    ],
  }, "Alcampo", "alcampo.es");

  assert.equal(out.classification, "franchise");
  assert.equal(out.operatorName, "Supermercados Villa SL");
  assert.equal(out.confidence, "high");
  assert.deepEqual(out.emails, ["gerencia@supermercadosvilla.es"]);
});

test("does not present a person as owner without two independent sources", () => {
  const out = normalizeOwnerResearch({
    classification: "franchise",
    operatorName: "Mercado Local SL",
    ownerName: "Juan Pérez",
    sources: [{ url: "https://directorio.example/ficha", title: "Directorio" }],
  }, "Alcampo", "alcampo.es");

  assert.equal(out.ownerName, null);
  assert.equal(out.confidence, "medium");
});
