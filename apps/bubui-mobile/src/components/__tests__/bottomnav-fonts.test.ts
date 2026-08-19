import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p: string) => readFileSync(resolve(__dirname, "..", p), "utf8");

describe("BottomNav icon regression", () => {
  const bottomNav = read("BottomNav.tsx");
  const navIcons = () => read("NavIcons.tsx");
  const importsVectorIcons = (src: string) => /^\s*import[^\n]*from\s+["']@expo\/vector-icons/m.test(src);

  it("does not depend on a runtime icon font", () => {
    expect(importsVectorIcons(bottomNav)).toBe(false);
    expect(bottomNav).toMatch(/from "\.\/NavIcons"/);
    expect(bottomNav).toMatch(/<NavIcon\b/);
  });

  it("provides font-independent SVG icons for every navigation action", () => {
    const src = navIcons();
    expect(src).toMatch(/from "react-native-svg"/);
    expect(importsVectorIcons(src)).toBe(false);
    for (const name of ["home", "compass", "map", "person", "scan"]) {
      expect(src).toContain(`"${name}"`);
    }
  });
});
