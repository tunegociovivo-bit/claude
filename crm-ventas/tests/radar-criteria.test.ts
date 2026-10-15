import test from "node:test";
import assert from "node:assert/strict";
import { parseCriteria, checkListing, matchesCriteria, criteriaErrors, describeCriteria } from "../lib/radar/criteria";
import type { MatchableListing } from "../lib/radar/criteria";

const base: MatchableListing = {
  portal: "auto1", title: "BMW Serie 1 118d Sport", make: "BMW", model: "Serie 1", version: "118d",
  year: 2020, km: 90000, price: 14500, fuel: "diesel", gearbox: "manual", powerCv: 150, country: "ES",
};

test("marca cumple con alias (Mercedes-Benz = Mercedes)", () => {
  const c = parseCriteria({ makes: ["mercedes"], priceMax: 30000 });
  assert.equal(matchesCriteria({ ...base, make: "Mercedes-Benz", model: "Clase A", title: "Mercedes-Benz Clase A" }, c), true);
  assert.equal(matchesCriteria(base, c), false); // BMW no es Mercedes
});

test("modelo se busca como palabra en marca+modelo+versión+título", () => {
  const c = parseCriteria({ models: ["Serie 1"] });
  assert.equal(matchesCriteria(base, c), true);
  assert.equal(matchesCriteria({ ...base, model: "Serie 3", title: "BMW Serie 3 320d" }, c), false);
});

test("rangos de precio, km y año", () => {
  assert.equal(matchesCriteria(base, parseCriteria({ priceMax: 15000, kmMax: 100000, yearMin: 2019 })), true);
  assert.equal(matchesCriteria(base, parseCriteria({ priceMax: 10000 })), false);
  assert.equal(matchesCriteria(base, parseCriteria({ kmMax: 50000 })), false);
  assert.equal(matchesCriteria(base, parseCriteria({ yearMin: 2022 })), false);
});

test("híbrido enchufable también cuenta como híbrido", () => {
  const phev = { ...base, fuel: "hibrido_enchufable" };
  assert.equal(matchesCriteria(phev, parseCriteria({ fuels: ["hibrido"] })), true);
  assert.equal(matchesCriteria(phev, parseCriteria({ fuels: ["hibrido_enchufable"] })), true);
  assert.equal(matchesCriteria(phev, parseCriteria({ fuels: ["gasolina"] })), false);
});

test("datos desconocidos: se descartan salvo includeUnknown", () => {
  const sinKm = { ...base, km: null };
  assert.equal(matchesCriteria(sinKm, parseCriteria({ kmMax: 100000 })), false);
  assert.equal(matchesCriteria(sinKm, parseCriteria({ kmMax: 100000, includeUnknown: true })), true);
});

test("palabras obligatorias y excluidas", () => {
  assert.equal(matchesCriteria(base, parseCriteria({ keywords: ["sport"] })), true);
  assert.equal(matchesCriteria(base, parseCriteria({ keywords: ["cabrio"] })), false);
  assert.equal(matchesCriteria(base, parseCriteria({ excludeKeywords: ["sport"] })), false);
});

test("filtro por portal y país", () => {
  assert.equal(matchesCriteria(base, parseCriteria({ portals: ["bca"] })), false);
  assert.equal(matchesCriteria(base, parseCriteria({ portals: ["auto1"] })), true);
  assert.equal(matchesCriteria(base, parseCriteria({ countries: ["FR"] })), false);
  assert.equal(matchesCriteria(base, parseCriteria({ countries: ["ES", "FR"] })), true);
});

test("checkListing explica el motivo del primer fallo", () => {
  const r = checkListing(base, parseCriteria({ priceMax: 10000 }));
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, "precio");
});

test("una búsqueda sin ninguna condición se rechaza", () => {
  assert.ok(criteriaErrors(parseCriteria({})).length > 0);
  assert.equal(criteriaErrors(parseCriteria({ priceMax: 15000 })).length, 0);
});

test("rangos invertidos dan error", () => {
  assert.ok(criteriaErrors(parseCriteria({ priceMin: 20000, priceMax: 10000 })).some((e) => /precio/i.test(e)));
  assert.ok(criteriaErrors(parseCriteria({ yearMin: 2024, yearMax: 2020 })).some((e) => /año/i.test(e)));
});

test("describeCriteria resume en texto legible", () => {
  const txt = describeCriteria(parseCriteria({ makes: ["BMW"], models: ["Serie 1"], priceMax: 15000, kmMax: 100000, fuels: ["diesel"] }));
  assert.match(txt, /BMW/);
  assert.match(txt, /15\.000/);
});
