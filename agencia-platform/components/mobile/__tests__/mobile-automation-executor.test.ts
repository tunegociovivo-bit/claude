import { describe, expect, it, vi } from "vitest";
import { executeMobileAutomationJob } from "@/components/mobile/mobile-automation-executor";
import { createInitialFacebookGroupBatch, serializeFacebookGroupBatch } from "@/lib/mobile/facebook-group-batch";

describe("mobile automation executor", () => {
  it("returns a navigation notice without posting or copying text", async () => {
    const copyText = vi.fn(async () => undefined);
    const result = await executeMobileAutomationJob({ action: "OPEN_URL", targetUrl: "https://www.facebook.com/search/posts/?q=franquicias", text: null }, {
      openUrl: async () => ({ summary: "Búsqueda general abierta" }), copyText
    });
    expect(result).toEqual({ outcome: "PREPARED", summary: "Búsqueda general abierta" });
    expect(copyText).not.toHaveBeenCalled();
  });
  it("opens and copies an approved job in order", async () => {
    const calls: string[] = [];
    const openUrl = vi.fn(async (url: string) => calls.push(`open:${url}`));
    const copyText = vi.fn(async (content: string) => calls.push(`copy:${content}`));

    await executeMobileAutomationJob(
      {
        action: "OPEN_URL_AND_COPY_TEXT",
        targetUrl: "https://www.google.com/maps/place/example",
        text: "Una experiencia real y excelente."
      },
      { openUrl, copyText }
    );

    expect(calls).toEqual([
      "open:https://www.google.com/maps/place/example",
      "copy:Una experiencia real y excelente."
    ]);
  });

  it("supports copy-only preparation without opening a target", async () => {
    const openUrl = vi.fn(async () => undefined);
    const copyText = vi.fn(async () => undefined);

    await executeMobileAutomationJob(
      { action: "COPY_TEXT", targetUrl: null, text: "Borrador aprobado" },
      { openUrl, copyText }
    );

    expect(openUrl).not.toHaveBeenCalled();
    expect(copyText).toHaveBeenCalledWith("Borrador aprobado");
  });

  it("uses the native Facebook group search instead of treating a web intent as success", async () => {
    const searchFacebookGroups = vi.fn(async () => undefined);

    await executeMobileAutomationJob(
      {
        action: "SEARCH_FACEBOOK_GROUPS",
        targetUrl: "https://www.facebook.com/search/groups/?q=franquicia",
        text: null,
        sourceRef: "franquicia"
      },
      { openUrl: vi.fn(), copyText: vi.fn(), searchFacebookGroups }
    );

    expect(searchFacebookGroups).toHaveBeenCalledWith("franquicia");
  });

  it("discovers and analyses several Facebook group result screens", async () => {
    const batch = createInitialFacebookGroupBatch({
      query: "franquicias",
      criteria: "Grupos de España con actividad reciente y sin spam.",
      answerFacts: "Dirijo una agencia de marketing en Málaga.",
      maxGroups: 10
    });
    const discoverFacebookGroups = vi.fn(async () => ({
      outcome: "DISCOVERED" as const,
      resultText: serializeFacebookGroupBatch(batch)
    }));

    const result = await executeMobileAutomationJob(
      {
        action: "DISCOVER_FACEBOOK_GROUPS",
        targetUrl: "https://www.facebook.com/search/groups/?q=franquicias",
        text: serializeFacebookGroupBatch(batch),
        sourceRef: "franquicias"
      },
      { openUrl: vi.fn(), copyText: vi.fn(), discoverFacebookGroups }
    );

    expect(discoverFacebookGroups).toHaveBeenCalledWith(batch);
    expect(result.outcome).toBe("DISCOVERED");
  });

  it("executes only the selected groups after one batch approval", async () => {
    const batch = {
      ...createInitialFacebookGroupBatch({
        query: "franquicias",
        criteria: "España",
        answerFacts: "Soy profesional del marketing.",
        maxGroups: 5
      }),
      candidates: normalizeCandidatesForExecutor()
    };
    const joinFacebookGroupBatch = vi.fn(async () => ({
      outcome: "COMPLETED" as const,
      resultText: serializeFacebookGroupBatch(batch)
    }));

    const result = await executeMobileAutomationJob(
      {
        action: "JOIN_FACEBOOK_GROUP_BATCH",
        targetUrl: "https://www.facebook.com/search/groups/?q=franquicias",
        text: serializeFacebookGroupBatch(batch),
        sourceRef: "franquicias"
      },
      { openUrl: vi.fn(), copyText: vi.fn(), joinFacebookGroupBatch }
    );

    expect(joinFacebookGroupBatch).toHaveBeenCalledWith(batch);
    expect(result.outcome).toBe("COMPLETED");
  });

  it("never accepts arbitrary actions from the server", async () => {
    await expect(
      executeMobileAutomationJob(
        {
          action: "SHELL_COMMAND" as "OPEN_URL",
          targetUrl: "https://example.com",
          text: "input tap 10 10"
        },
        { openUrl: vi.fn(), copyText: vi.fn(), searchFacebookGroups: vi.fn() }
      )
    ).rejects.toThrow(/no permitida/i);
  });

  it("requires the data needed by each allowlisted action", async () => {
    await expect(
      executeMobileAutomationJob(
        { action: "OPEN_URL", targetUrl: null, text: null },
        { openUrl: vi.fn(), copyText: vi.fn(), searchFacebookGroups: vi.fn() }
      )
    ).rejects.toThrow(/URL/i);

    await expect(
      executeMobileAutomationJob(
        { action: "COPY_TEXT", targetUrl: null, text: null },
        { openUrl: vi.fn(), copyText: vi.fn(), searchFacebookGroups: vi.fn() }
      )
    ).rejects.toThrow(/texto/i);
  });
});

function normalizeCandidatesForExecutor() {
  return [
    {
      id: "franquicias-en-espana",
      name: "Franquicias en España",
      details: "554 miembros",
      relevanceScore: 91,
      reason: "Coincide con los criterios.",
      selected: true,
      outcome: "pending" as const,
      resultDetail: null
    },
    {
      id: "franquicias-mexico",
      name: "Franquicias México",
      details: "2.000 miembros",
      relevanceScore: 35,
      reason: "Fuera de España.",
      selected: false,
      outcome: "pending" as const,
      resultDetail: null
    }
  ];
}
