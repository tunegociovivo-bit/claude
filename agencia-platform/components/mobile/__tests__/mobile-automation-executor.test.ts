import { describe, expect, it, vi } from "vitest";
import { executeMobileAutomationJob } from "@/components/mobile/mobile-automation-executor";

describe("mobile automation executor", () => {
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
