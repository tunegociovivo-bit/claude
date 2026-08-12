/**
 * El enlace /reto/<token> debe:
 *  - reconocerse como enlace de reto (para NO enrutarlo a una pantalla
 *    inexistente en React Navigation), y
 *  - dejar que deal-pending capture el token tanto con la app instalada (deep
 *    link / app-link) como en las variantes de URL.
 */
import { describe, it, expect, vi } from "vitest";

// links.ts importa API_BASE de ./api (que a su vez arrastra RN/expo). Para
// probar el helper puro `retoTokenFromPath`, mockeamos esas dependencias.
vi.mock("react-native", () => ({ Linking: { openURL: vi.fn(() => Promise.resolve()) } }));
vi.mock("../api", () => ({ API_BASE: "https://bubui.app" }));

import { retoTokenFromPath } from "../links";

const TOKEN = "aaac414dd4505807"; // token de la incidencia

describe("retoTokenFromPath", () => {
  it("reconoce el token en app-link https, en la ruta y en el deep link", () => {
    expect(retoTokenFromPath(`https://bubui.app/reto/${TOKEN}`)).toBe(TOKEN);
    expect(retoTokenFromPath(`https://www.bubui.app/reto/${TOKEN}?utm=x`)).toBe(TOKEN);
    expect(retoTokenFromPath(`/reto/${TOKEN}`)).toBe(TOKEN);
    expect(retoTokenFromPath(`bubui://reto/${TOKEN}`)).toBe(TOKEN);
  });
  it("no confunde otras rutas", () => {
    expect(retoTokenFromPath(`https://bubui.app/scan/biz123`)).toBeNull();
    expect(retoTokenFromPath("/offers")).toBeNull();
    expect(retoTokenFromPath(null)).toBeNull();
  });
});
