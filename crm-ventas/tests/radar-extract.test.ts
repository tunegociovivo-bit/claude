import test from "node:test";
import assert from "node:assert/strict";
import { extractVehiclesFromJson, findVehicleArrays, mapVehicle } from "../lib/radar/extract-json";
import { parseInteger, parseYear, normalizeFuel, normalizeGearbox, normalizeCountry } from "../lib/radar/normalize";

test("parseInteger entiende formatos europeos y anglosajones", () => {
  assert.equal(parseInteger("12.500 €"), 12500);
  assert.equal(parseInteger("12,500.50"), 12500);
  assert.equal(parseInteger("45.000 km"), 45000);
  assert.equal(parseInteger("1.234.567"), 1234567);
  assert.equal(parseInteger(98000), 98000);
  assert.equal(parseInteger(""), null);
});

test("parseYear saca el año de fechas y textos", () => {
  assert.equal(parseYear("03/2019"), 2019);
  assert.equal(parseYear("2021-06-01"), 2021);
  assert.equal(parseYear(2018), 2018);
  assert.equal(parseYear("hace mucho"), null);
});

test("normaliza combustible y cambio en varios idiomas", () => {
  assert.equal(normalizeFuel("Gasóil"), "diesel");
  assert.equal(normalizeFuel("Benzin"), "gasolina");
  assert.equal(normalizeFuel("Plug-in Hybrid"), "hibrido_enchufable");
  assert.equal(normalizeGearbox("Boîte automatique"), "automatico");
  assert.equal(normalizeGearbox("Schaltgetriebe"), "manual");
  assert.equal(normalizeCountry("Allemagne"), "DE");
  assert.equal(normalizeCountry("es"), "ES");
});

test("encuentra el array de coches dentro de una respuesta anidada", () => {
  const api = {
    data: {
      results: {
        items: [
          { id: 1, make: "BMW", model: "X1", mileage: 80000, price: { amount: 15000 }, firstRegistration: "2019-01-01", fuelType: "Diesel", gearbox: "Manual" },
          { id: 2, make: "Audi", model: "A3", mileage: 60000, price: { amount: 18000 }, firstRegistration: "2020-01-01", fuelType: "Gasoline", gearbox: "Automatic" },
        ],
      },
    },
  };
  const arrays = findVehicleArrays(api);
  assert.equal(arrays.length, 1);
  assert.equal(arrays[0].length, 2);
});

test("mapea un objeto de coche al formato común", () => {
  const v = mapVehicle({
    stockNumber: "AB123",
    brand: "Volkswagen",
    model: "Golf",
    version: "1.6 TDI",
    mileage: "95.000 km",
    currentBid: "11.200 €",
    firstRegistrationDate: "05/2018",
    fuelType: "Diesel",
    transmission: "Manual",
    powerKw: 85,
    country: "España",
    detailUrl: "https://portal.example/car/AB123",
  }, { baseUrl: "https://portal.example" });
  assert.ok(v);
  assert.equal(v!.externalId, "AB123");
  assert.equal(v!.make, "Volkswagen");
  assert.equal(v!.km, 95000);
  assert.equal(v!.price, 11200);
  assert.equal(v!.priceLabel, "Puja actual");
  assert.equal(v!.year, 2018);
  assert.equal(v!.fuel, "diesel");
  assert.equal(v!.gearbox, "manual");
  assert.equal(v!.powerCv, Math.round(85 * 1.35962));
  assert.equal(v!.country, "ES");
});

test("extractVehiclesFromJson quita duplicados por id", () => {
  const json = { items: [ { id: "A", make: "BMW", title: "BMW 1", price: 10000, mileage: 1000 }, { id: "A", make: "BMW", title: "BMW 1", price: 10000, mileage: 1000 } ] };
  assert.equal(extractVehiclesFromJson(json).length, 1);
});

test("ignora arrays que no son de coches (menús, etc.)", () => {
  const json = { menu: [ { id: 1, label: "Inicio", url: "/" }, { id: 2, label: "Ayuda", url: "/help" } ] };
  assert.equal(findVehicleArrays(json).length, 0);
});
