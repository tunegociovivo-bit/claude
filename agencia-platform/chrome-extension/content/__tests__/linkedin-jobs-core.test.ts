import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

function loadCore() {
  const source = readFileSync(new URL("../linkedin-jobs-core.js", import.meta.url), "utf8");
  const sandbox = { globalThis: {} as Record<string, unknown>, URL, encodeURIComponent };
  runInNewContext(source, sandbox);
  return (sandbox.globalThis as any).NVLinkedInJobsCore;
}

describe("LinkedIn jobs capture core", () => {
  it("normaliza la URL y construye una oferta apta para el pipeline", () => {
    const core = loadCore();
    expect(core.buildPayload({
      company: " Acme ",
      jobTitle: " Especialista SEO ",
      location: " Madrid ",
      jobUrl: "https://www.linkedin.com/jobs/view/123/?trackingId=secret",
      companyUrl: "https://www.linkedin.com/company/acme/?trk=job",
      description: " Una vacante de marketing "
    })).toEqual({
      company: "Acme",
      jobTitle: "Especialista SEO",
      location: "Madrid",
      jobUrl: "https://www.linkedin.com/jobs/view/123",
      companyUrl: "https://www.linkedin.com/company/acme/",
      description: "Una vacante de marketing"
    });
  });

  it("rechaza tarjetas incompletas y enlaces que no son ofertas", () => {
    const core = loadCore();
    expect(core.buildPayload({ company: "Acme", jobTitle: "SEO", jobUrl: "https://www.linkedin.com/feed/" })).toBeNull();
    expect(core.buildPayload({ company: "", jobTitle: "SEO", jobUrl: "https://www.linkedin.com/jobs/view/123" })).toBeNull();
  });
});
