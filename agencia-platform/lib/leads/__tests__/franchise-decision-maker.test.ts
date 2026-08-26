import { describe, expect, it } from "vitest";
import { rankFranchiseDecisionMakers } from "../franchise-decision-maker";
import { extractCorporateMailboxes } from "../franchise-public-contact-research";

describe("rankFranchiseDecisionMakers", () => {
  it("prioriza a una directora de marketing con email corporativo verificado", () => {
    const [best] = rankFranchiseDecisionMakers([{ email: "ana@marca.es", name: "Ana Ruiz", role: "Directora de Marketing", providerConfidence: 95 }], "marca.es");
    expect(best.confidence).toBe("high");
    expect(best.sendAllowed).toBe(true);
  });

  it("bloquea buzones genéricos aunque pertenezcan al dominio", () => {
    const [best] = rankFranchiseDecisionMakers([{ email: "franquicias@marca.es", role: "Expansión" }], "marca.es");
    expect(best.sendAllowed).toBe(false);
  });

  it("acepta un buzón funcional publicado con evidencia sectorial", () => {
    const [best] = rankFranchiseDecisionMakers([{ email: "exporestalia@gruporestalia.com", name: "ExpoRestalia", role: "Expansión y franquicias", source: "aef_directory", providerConfidence: 85, evidenceUrl: "https://www.aefranquicia.es/ensenas/100-montaditos/" }], "100montaditos.com");
    expect(best.sendAllowed).toBe(true);
    expect(best.reasons).toContain("buzón funcional corporativo");
  });

  it("no habilita envíos a buzones funcionales propuestos solo por una IA", () => {
    const [best] = rankFranchiseDecisionMakers([{ email: "marketing@empresa-ajena.com", name: "Departamento", role: "Marketing", source: "perplexity_public_web", providerConfidence: 90, evidenceUrl: "https://example.com" }], "marca.es");
    expect(best.sendAllowed).toBe(false);
  });

  it("permite continuar con el contacto general publicado en la web corporativa", () => {
    const [best] = rankFranchiseDecisionMakers([{ email: "info@marca.es", name: "Contacto corporativo", role: "Contacto general de la central", source: "corporate_website_literal", providerConfidence: 80, evidenceUrl: "https://marca.es/contacto" }], "marca.es");
    expect(best.sendAllowed).toBe(true);
  });

  it("permite un correo corporativo literal aunque su prefijo no sea genérico", () => {
    const [best] = rankFranchiseDecisionMakers([{ email: "secretaria@marca.es", name: "Contacto corporativo", role: "Correo corporativo publicado por la central", source: "corporate_website_literal", providerConfidence: 80, evidenceUrl: "https://marca.es/aviso-legal" }], "marca.es");
    expect(best.sendAllowed).toBe(true);
    expect(best.reasons).toContain("correo publicado literalmente por la empresa");
  });

  it("mantiene bloqueados soporte y atención al cliente aunque estén publicados", () => {
    const ranked = rankFranchiseDecisionMakers([
      { email: "soporte@marca.es", source: "corporate_website_literal", evidenceUrl: "https://marca.es" },
      { email: "atencioncliente@marca.es", source: "corporate_website_literal", evidenceUrl: "https://marca.es" }
    ], "marca.es");
    expect(ranked.every((candidate) => !candidate.sendAllowed)).toBe(true);
  });

  it("penaliza privacidad, soporte y dominios ajenos", () => {
    const ranked = rankFranchiseDecisionMakers([
      { email: "privacy@marca.es", name: "Equipo legal", role: "Legal" },
      { email: "ana@agencia-externa.es", name: "Ana", role: "Marketing Manager" }
    ], "marca.es");
    expect(ranked.every((candidate) => !candidate.sendAllowed)).toBe(true);
    expect(ranked.every((candidate) => !candidate.copyAllowed)).toBe(true);
  });

  it("permite CCO a otros responsables relevantes pero nunca a buzones genéricos", () => {
    const ranked = rankFranchiseDecisionMakers([
      { email: "ana@marca.es", name: "Ana", role: "Directora de Marketing", providerConfidence: 95 },
      { email: "luis@marca.es", name: "Luis", role: "Brand Manager", providerConfidence: 75 },
      { email: "info@marca.es", name: "Central", role: "Marketing" }
    ], "marca.es");
    expect(ranked.find((candidate) => candidate.email === "luis@marca.es")?.copyAllowed).toBe(true);
    expect(ranked.find((candidate) => candidate.email === "info@marca.es")?.copyAllowed).toBe(false);
  });
});

describe("extractCorporateMailboxes", () => {
  it("extrae contactos accionables del dominio y excluye departamentos incorrectos", () => {
    const contacts = extractCorporateMailboxes([{ url: "https://marca.es/contacto", html: "info@marca.es marketing@marca.es legal@marca.es info@otra.es" }], "marca.es");
    expect(contacts.map((contact) => contact.email)).toEqual(["info@marca.es", "marketing@marca.es"]);
    expect(contacts.every((contact) => contact.evidenceUrl === "https://marca.es/contacto")).toBe(true);
  });
});
