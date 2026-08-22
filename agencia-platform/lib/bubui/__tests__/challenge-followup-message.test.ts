import { describe, expect, it } from "vitest";
import { buildChallengeFollowupMessage } from "../challenge-followup-message";

describe("buildChallengeFollowupMessage", () => {
  it("includes the exact challenge context and three decisions", () => {
    const result = buildChallengeFollowupMessage({ businessName: "Roman Trainer", friendName: "Sonia", challengeTitle: "Entrenamiento 3 meses", discountPct: 16, second: false, reviewUrl: "https://hub.negociovivo.app/bubui/negocio#retos-activos" });
    expect(result.subject).toContain("Sonia");
    expect(result.text).toContain("16%");
    expect(result.text).toContain("Entrenamiento 3 meses");
    expect(result.html).toContain("Responder ahora");
    expect(result.html).toContain("✅ Sí");
    expect(result.html).toContain("❌ No");
    expect(result.html).toContain("Todavía no");
  });

  it("escapes business data in HTML", () => {
    const result = buildChallengeFollowupMessage({ businessName: "<script>x</script>", friendName: "Ana & Luis", second: true, reviewUrl: "https://hub.negociovivo.app" });
    expect(result.html).not.toContain("<script>x</script>");
    expect(result.html).toContain("Ana &amp; Luis");
  });
});
