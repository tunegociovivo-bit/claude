import { describe, it, expect } from "vitest";
import { computeCitationTransition, classifyObservation, buildSubmissionPacket, isActionableStatus } from "../citations/engine";
import { recommendDirectories, directoryBySlug, DIRECTORIES } from "../citations/directories";

describe("citation transitions", () => {
  it("detect: not_found → pending", () => {
    expect(computeCitationTransition("not_found", "detect")).toMatchObject({ ok: true, next: "pending" });
  });
  it("prepare → submit → publish", () => {
    expect(computeCitationTransition("pending", "prepare")).toMatchObject({ ok: true, next: "prepared" });
    expect(computeCitationTransition("prepared", "submit")).toMatchObject({ ok: true, next: "submitted" });
    expect(computeCitationTransition("submitted", "publish")).toMatchObject({ ok: true, next: "published" });
  });
  it("transición inválida rechazada", () => {
    expect(computeCitationTransition("not_found", "publish").ok).toBe(false);
  });
  it("retry solo desde error", () => {
    expect(computeCitationTransition("error", "retry")).toMatchObject({ ok: true, next: "pending" });
    expect(computeCitationTransition("pending", "retry").ok).toBe(false);
  });
});

describe("classifyObservation", () => {
  const canonical = { name: "Sergisa SL", address: "C/ Calvario 32", phone: "952796658", website: "sergisa.es" };
  it("sin datos observados → conserva not_found", () => {
    expect(classifyObservation(canonical, null, "not_found").status).toBe("not_found");
  });
  it("datos consistentes → published", () => {
    const r = classifyObservation(canonical, { name: "SERGISA S.L.", phone: "952 79 66 58" }, "submitted");
    expect(r.status).toBe("published");
  });
  it("datos inconsistentes → inconsistent con diff", () => {
    const r = classifyObservation(canonical, { phone: "666000000" }, "published");
    expect(r.status).toBe("inconsistent");
    expect(r.diff?.phone).toBe(true);
  });
});

describe("submission packet + directorios", () => {
  it("paquete de alta usa el NAP canónico y la URL real, sin publicar", () => {
    const dir = directoryBySlug("paginas-amarillas")!;
    const packet = buildSubmissionPacket(dir, { name: "Sergisa SL", address: "C/ Calvario 32", phone: "952796658", website: "sergisa.es" });
    expect(packet.submitUrl).toBe(dir.submitUrl);
    expect(packet.fields.name).toBe("Sergisa SL");
    expect(packet.note).toMatch(/no publica nada/i);
  });
  it("recomienda generalistas + del sector, ordenado por autoridad", () => {
    const recs = recommendDirectories("restaurante");
    expect(recs.some((d) => d.slug === "tripadvisor")).toBe(true); // sector
    expect(recs.some((d) => d.slug === "google-business")).toBe(true); // generalista
    expect(recs[0].authority).toBeGreaterThanOrEqual(recs[recs.length - 1].authority);
    // un sector no relacionado no trae directorios de restaurante
    expect(recommendDirectories("dental").some((d) => d.slug === "doctoralia")).toBe(true);
    expect(recommendDirectories("dental").some((d) => d.slug === "eldtenedor")).toBe(false);
  });
  it("isActionableStatus: published no es accionable; inconsistent sí", () => {
    expect(isActionableStatus("published")).toBe(false);
    expect(isActionableStatus("inconsistent")).toBe(true);
    expect(DIRECTORIES.every((d) => d.slug && d.submitUrl.startsWith("http"))).toBe(true);
  });
});
