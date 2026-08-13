import assert from "node:assert/strict";
import test from "node:test";
import {
  dedupeBrandLocations,
  isBrandLocation,
  normalizeBrandName,
} from "../lib/leads/franchise-brand-search.ts";

test("normalizes accents, punctuation and common store descriptors", () => {
  assert.equal(normalizeBrandName("  Alcampo Supermercado "), "alcampo");
  assert.equal(normalizeBrandName("HIPERMERCADO ALCAMPO, S.A."), "alcampo");
});

test("accepts locations from the requested brand and rejects other chains", () => {
  assert.equal(isBrandLocation("Alcampo Moratalaz", "Alcampo"), true);
  assert.equal(isBrandLocation("Mi Alcampo Madrid", "Alcampo"), true);
  assert.equal(isBrandLocation("Carrefour Alcampo de fútbol", "Alcampo"), false);
  assert.equal(isBrandLocation("Carrefour Market", "Alcampo"), false);
});

test("deduplicates locations by Google place id", () => {
  const locations = [
    { placeId: "p1", name: "Alcampo Uno" },
    { placeId: "p1", name: "Alcampo Uno duplicado" },
    { placeId: "p2", name: "Mi Alcampo Dos" },
  ];
  assert.deepEqual(dedupeBrandLocations(locations).map((item) => item.placeId), ["p1", "p2"]);
});
