import { describe, expect, it } from "vitest";
import { isJobAlertSender, parseInfoJobsAlertText } from "../sources/jobs-inbox";

describe("isJobAlertSender", () => {
  it("accepts Google Alerts and supported job portals", () => {
    expect(isJobAlertSender("Google Alerts <googlealerts-noreply@google.com>")).toBe(true);
    expect(isJobAlertSender("jobs-noreply@linkedin.com")).toBe(true);
  });

  it("does not accept arbitrary Google or unrelated mail", () => {
    expect(isJobAlertSender("someone@google.com")).toBe(false);
    expect(isJobAlertSender("newsletter@example.com")).toBe(false);
  });
});

describe("parseInfoJobsAlertText", () => {
  it("extracts every offer from an InfoJobs alert without using AI", () => {
    const text = `Hola, David

Estas son las ofertas que hemos encontrado para ti

Senior Marketing Specialist
SALSAS ASTURIANAS SL
Llanera | Presencial | Indefinido

Marketing specialist
HOLIDAY ACADEMY SL.
Las Rozas de Madrid | Presencial | Indefinido

Content Marketing Specialist
IDEAL EDUCATION GROUP
Madrid | Presencial | Indefinido

VER MÁS OFERTAS COMO ESTAS
Privacidad | Ayuda | Contacto`;

    expect(parseInfoJobsAlertText(text)).toEqual([
      {
        company: "SALSAS ASTURIANAS SL",
        jobTitle: "Senior Marketing Specialist",
        location: "Llanera",
        jobUrl: null,
        companyUrl: null,
        board: "infojobs",
        description: "Llanera | Presencial | Indefinido"
      },
      {
        company: "HOLIDAY ACADEMY SL.",
        jobTitle: "Marketing specialist",
        location: "Las Rozas de Madrid",
        jobUrl: null,
        companyUrl: null,
        board: "infojobs",
        description: "Las Rozas de Madrid | Presencial | Indefinido"
      },
      {
        company: "IDEAL EDUCATION GROUP",
        jobTitle: "Content Marketing Specialist",
        location: "Madrid",
        jobUrl: null,
        companyUrl: null,
        board: "infojobs",
        description: "Madrid | Presencial | Indefinido"
      }
    ]);
  });

  it("ignores footer rows and unrelated messages", () => {
    expect(parseInfoJobsAlertText("Privacidad | Ayuda | Contacto")).toEqual([]);
    expect(parseInfoJobsAlertText("Hola, esta semana no hay ofertas nuevas para ti.")).toEqual([]);
  });

  it("preserves table cell boundaries in HTML-only InfoJobs messages", () => {
    const html = `<html><body><table>
      <tr><td>Hola, David</td></tr>
      <tr><td>Estas son las ofertas de empleo que hemos encontrado basadas en tu alerta.</td></tr>
      <tr><td><table>
        <tr><td><a href="https://example.com/job">Senior Marketing Specialist</a></td></tr>
        <tr><td>SALSAS ASTURIANAS SL</td></tr>
        <tr><td>Llanera | Presencial | Indefinido</td></tr>
      </table></td></tr>
      <tr><td>VER MÁS OFERTAS COMO ESTAS</td></tr>
    </table></body></html>`;

    expect(parseInfoJobsAlertText(html)).toEqual([
      {
        company: "SALSAS ASTURIANAS SL",
        jobTitle: "Senior Marketing Specialist",
        location: "Llanera",
        jobUrl: null,
        companyUrl: null,
        board: "infojobs",
        description: "Llanera | Presencial | Indefinido"
      }
    ]);
  });
});
