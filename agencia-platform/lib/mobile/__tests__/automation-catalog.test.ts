import { describe, expect, it } from "vitest";
import {
  buildAutomationTargetUrl,
  getAutomationWorkflows
} from "../automation-catalog";

describe("catálogo de automatizaciones por plataforma", () => {
  it("ofrece en Facebook grupos, detección de conversaciones y respuestas", () => {
    expect(getAutomationWorkflows("facebook").map((item) => item.sourceKind)).toEqual([
      "GROUP_DISCOVERY",
      "GROUP_JOIN_REQUEST",
      "COMMENT_DISCOVERY",
      "COMMENT_REPLY",
      "OWNED_POST",
      "LINK_SHARE"
    ]);
  });

  it("no muestra acciones de grupos fuera de Facebook", () => {
    expect(getAutomationWorkflows("instagram").map((item) => item.sourceKind)).toEqual([
      "COMMENT_DISCOVERY",
      "COMMENT_REPLY",
      "OWNED_POST",
      "LINK_SHARE"
    ]);
    expect(getAutomationWorkflows("google_maps").map((item) => item.sourceKind)).toEqual([
      "REAL_REVIEW"
    ]);
  });

  it("construye la búsqueda de grupos de Facebook desde la temática", () => {
    expect(buildAutomationTargetUrl("facebook", "GROUP_DISCOVERY", "viajes a Japón")).toBe(
      "https://www.facebook.com/search/groups/?q=viajes+a+Jap%C3%B3n"
    );
  });
});
