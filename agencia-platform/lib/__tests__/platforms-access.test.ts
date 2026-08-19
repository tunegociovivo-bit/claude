import { describe, expect, it } from "vitest";
import { platformsVisibleTo } from "../platforms";

describe("platformsVisibleTo", () => {
  it("mantiene compatible memberIds vacío como acceso público", () => {
    const visible = platformsVisibleTo({
      platforms: { nv_leads: { enabled: true, memberIds: [] } }
    }, "user-1", false);
    expect(visible.some((platform) => platform.key === "nv_leads")).toBe(true);
  });

  it("permite una plataforma privada sin ningún trabajador", () => {
    const visible = platformsVisibleTo({
      platforms: { nv_leads: { enabled: true, memberIds: [], restricted: true } }
    }, "user-1", false);
    expect(visible.some((platform) => platform.key === "nv_leads")).toBe(false);
  });

  it("en modo privado solo muestra la plataforma a usuarios seleccionados", () => {
    const settings = {
      platforms: { nv_leads: { enabled: true, memberIds: ["user-1"], restricted: true } }
    };
    expect(platformsVisibleTo(settings, "user-1", false).some((platform) => platform.key === "nv_leads")).toBe(true);
    expect(platformsVisibleTo(settings, "user-2", false).some((platform) => platform.key === "nv_leads")).toBe(false);
  });

  it("los administradores conservan acceso a plataformas privadas", () => {
    const visible = platformsVisibleTo({
      platforms: { nv_leads: { enabled: true, memberIds: [], restricted: true } }
    }, "admin", true);
    expect(visible.some((platform) => platform.key === "nv_leads")).toBe(true);
  });
});
