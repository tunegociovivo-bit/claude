/**
 * Garantía: el menú inferior NO depende de @expo/vector-icons (cuya fuente no
 * cargaba en release y dejaba los iconos en blanco). Los iconos se dibujan con
 * react-native-svg (vectores nativos), independientes de cualquier fuente.
 *
 * Es un test ESTÁTICO de la fuente: barato, determinista y evita que una futura
 * regresión vuelva a introducir la dependencia de fuente en el nav.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p: string) => readFileSync(resolve(__dirname, "..", p), "utf8");

describe("BottomNav — iconos independientes de fuentes", () => {
  const bottomNav = read("BottomNav.tsx");
  const navIcons = read("NavIcons.tsx");

  // Comprueba IMPORTS reales (no menciones en comentarios).
  const importsVectorIcons = (src: string) => /^\s*import[^\n]*from\s+["']@expo\/vector-icons/m.test(src);

  it("BottomNav.tsx NO importa @expo/vector-icons", () => {
    expect(importsVectorIcons(bottomNav)).toBe(false);
  });

  it("BottomNav.tsx usa los iconos SVG (NavIcon)", () => {
    expect(bottomNav).toMatch(/from "\.\/NavIcons"/);
    expect(bottomNav).toMatch(/<NavIcon\b/);
  });

  it("NavIcons.tsx se dibuja con react-native-svg y NO importa fuentes de iconos", () => {
    expect(navIcons).toMatch(/from "react-native-svg"/);
    expect(importsVectorIcons(navIcons)).toBe(false);
  });

  it("cubre las 5 acciones del nav (4 pestañas + FAB escanear)", () => {
    for (const name of ["home", "compass", "map", "person", "scan"]) {
      expect(navIcons).toContain(`"${name}"`);
    }
  });
});
