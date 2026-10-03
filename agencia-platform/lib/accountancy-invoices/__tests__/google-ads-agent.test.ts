import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { pickGoogleAdsAgentKey } from "../agents";

const now = new Date("2026-10-03T10:00:00.000Z");
const minutesAgo = (minutes: number) => new Date(now.getTime() - minutes * 60_000);

describe("Google Ads browser agent selection", () => {
  it("hands Google Ads to the live profile when the oldest registration is stale", () => {
    // Caso real: perfil antiguo (10-sep) desaparecido tras reinstalar la
    // extensión; el perfil nuevo (11-sep) consulta la cola cada 30 s.
    const agents = [
      { agentKey: "old-profile", createdAt: new Date("2026-09-01T08:00:00Z"), lastHeartbeatAt: new Date("2026-09-10T19:17:00Z") },
      { agentKey: "029f78f8", createdAt: new Date("2026-09-11T08:15:37Z"), lastHeartbeatAt: minutesAgo(0.5) }
    ];
    expect(pickGoogleAdsAgentKey(agents, now)).toBe("029f78f8");
  });

  it("keeps a stable owner among several live profiles", () => {
    const agents = [
      { agentKey: "newer", createdAt: new Date("2026-09-20T00:00:00Z"), lastHeartbeatAt: minutesAgo(0.2) },
      { agentKey: "older", createdAt: new Date("2026-09-11T00:00:00Z"), lastHeartbeatAt: minutesAgo(1) }
    ];
    expect(pickGoogleAdsAgentKey(agents, now)).toBe("older");
  });

  it("returns no owner when every profile is offline", () => {
    const agents = [{ agentKey: "offline", createdAt: new Date("2026-09-11T00:00:00Z"), lastHeartbeatAt: minutesAgo(30) }];
    expect(pickGoogleAdsAgentKey(agents, now)).toBeNull();
  });

  it("routes Google Ads claims through the live-profile rule", () => {
    const route = readFileSync(resolve(process.cwd(), "app/api/v1/admin/accountancy-invoices/agent/route.ts"), "utf8");
    expect(route).toContain("pickGoogleAdsAgentKey(agents) === agentKey");
    expect(route).not.toContain('orderBy: { createdAt: "asc" }, select: { agentKey: true }');
  });
});
