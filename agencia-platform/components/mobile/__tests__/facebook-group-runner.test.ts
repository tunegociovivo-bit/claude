import { describe, expect, it, vi } from "vitest";
import { FacebookNavigationError } from "@/components/mobile/facebook-android-launch";
import { finishFacebookGroupSearch, runFacebookGroupCandidates } from "@/components/mobile/facebook-group-runner";
import type { FacebookGroupCandidate } from "@/lib/mobile/facebook-group-batch";

const candidate = (id: string, outcome: FacebookGroupCandidate["outcome"] = "pending"): FacebookGroupCandidate => ({
  id, name: id, outcome, selected: true, details: "", reason: "Relevant", relevanceScore: 80, resultDetail: null
});

describe("Facebook batch recovery", () => {
  it("stops repeating navigation failures and preserves confirmed memberships", async () => {
    const join = vi.fn(async () => { throw new FacebookNavigationError("Facebook no está abierto"); });
    const wait = vi.fn();
    const results = await runFacebookGroupCandidates([candidate("one"), candidate("two"), candidate("three", "joined")], join, wait);
    expect(join).toHaveBeenCalledTimes(1);
    expect(results.map((item) => item.outcome)).toEqual(["failed", "failed", "joined"]);
    expect(results[0].resultDetail).toBe("Facebook no está abierto");
    expect(wait).not.toHaveBeenCalled();
  });
  it("continues after a group-specific failure and skips unselected candidates", async () => {
    const join = vi.fn(async (item: FacebookGroupCandidate) => {
      if (item.id === "one") throw new Error("Grupo no disponible");
      return { ...item, outcome: "requested" as const };
    });
    const results = await runFacebookGroupCandidates([candidate("one"), { ...candidate("two"), selected: false }, candidate("three")], join, vi.fn());
    expect(join).toHaveBeenCalledTimes(2);
    expect(results.map((item) => item.outcome)).toEqual(["failed", "pending", "requested"]);
  });
});

describe("Facebook search completion", () => {
  it("opens Groups after selecting a suggestion instead of returning early", async () => {
    const dependencies = { selectSuggestion: vi.fn(async () => true), submitKeyboard: vi.fn(), selectGroups: vi.fn(async () => true) };
    await finishFacebookGroupSearch(dependencies);
    expect(dependencies.selectGroups).toHaveBeenCalledOnce();
    expect(dependencies.submitKeyboard).not.toHaveBeenCalled();
  });
  it("uses the keyboard when no suggestion is available and still verifies Groups", async () => {
    const calls: string[] = [];
    await finishFacebookGroupSearch({
      selectSuggestion: async () => false,
      submitKeyboard: async () => { calls.push("submit"); },
      selectGroups: async () => { calls.push("groups"); return true; }
    });
    expect(calls).toEqual(["submit", "groups"]);
  });
  it("does not report success on an unfiltered search page", async () => {
    await expect(finishFacebookGroupSearch({ selectSuggestion: async () => true, submitKeyboard: vi.fn(), selectGroups: async () => false })).rejects.toBeInstanceOf(FacebookNavigationError);
  });
});
