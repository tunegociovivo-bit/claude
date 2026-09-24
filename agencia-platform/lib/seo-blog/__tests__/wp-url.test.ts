import { describe, expect, it } from "vitest";
import { normalizeSiteUrl } from "../wp";

describe("normalizeSiteUrl", () => {
  it("añade https y quita barras finales", () => {
    expect(normalizeSiteUrl("clinicamarch.com/")).toBe("https://clinicamarch.com");
    expect(normalizeSiteUrl("  https://www.cliente.com///  ")).toBe("https://www.cliente.com");
  });
  it("quita rutas de administración y login", () => {
    expect(normalizeSiteUrl("https://clinicamarch.com/wp-admin/")).toBe("https://clinicamarch.com");
    expect(normalizeSiteUrl("https://clinicamarch.com/wp-login.php?redirect_to=x")).toBe("https://clinicamarch.com");
    expect(normalizeSiteUrl("https://clinicamarch.com/wp-json/wp/v2")).toBe("https://clinicamarch.com");
  });
  it("conserva subdirectorios reales del WordPress", () => {
    expect(normalizeSiteUrl("https://cliente.com/blog/")).toBe("https://cliente.com/blog");
    expect(normalizeSiteUrl("https://cliente.com/blog/wp-admin")).toBe("https://cliente.com/blog");
  });
  it("vacío → vacío", () => {
    expect(normalizeSiteUrl("")).toBe("");
  });
});
