import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { challengeNotificationDestination } from "../challenge-followup-notification";

const panelSource = readFileSync(resolve(__dirname, "../../../app/bubui/negocio/page.tsx"), "utf8");

describe("challenge follow-up notification action", () => {
  it("opens the active challenges area for legacy follow-up notifications", () => {
    expect(challengeNotificationDestination("challenge_followup")).toEqual({
      panelTab: "nicho",
      anchor: "retos-activos"
    });
  });

  it("does not turn unrelated news into challenge actions", () => {
    expect(challengeNotificationDestination("ranking_winner")).toBeNull();
  });

  it("renders an actionable legacy notification and the pending response controls", () => {
    expect(panelSource).toContain("Ver datos y responder ahora");
    expect(panelSource).toContain('id="retos-activos"');
    expect(panelSource).toContain("Respuesta pendiente");
    expect(panelSource).toContain("Confirma si contrataron el servicio");
    expect(panelSource).toContain('answerFriend(challenge.offerId, friend.customerId, "yes")');
    expect(panelSource).toContain('answerFriend(challenge.offerId, friend.customerId, "no")');
    expect(panelSource).toContain('answerFriend(challenge.offerId, friend.customerId, "later")');
  });
});
