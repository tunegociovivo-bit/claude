import { describe, expect, it } from "vitest";
import { spainJobAreas } from "../sources/jobs";

describe("barrido nacional de LinkedIn Jobs", () => {
  it("cubre las 52 provincias en vez de limitarse a seis grandes ciudades", () => {
    const areas = spainJobAreas();

    expect(areas).toHaveLength(52);
    expect(areas).toEqual(expect.arrayContaining([
      "Madrid",
      "Barcelona",
      "Oviedo",
      "Las Palmas de Gran Canaria",
      "Santa Cruz de Tenerife",
      "Ceuta",
      "Melilla"
    ]));
  });
});
