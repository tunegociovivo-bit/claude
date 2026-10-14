import { beforeEach, describe, expect, it } from "vitest";
import { hasViewers, markViewer, queueCommand, readSnapshot, resetStationRelayForTests, saveSnapshot, snapshotInfo, takeCommands } from "@/lib/mobile/station-relay";

describe("station relay", () => {
  beforeEach(() => resetStationRelayForTests());

  it("keeps the latest screen per workspace and phone", () => {
    saveSnapshot("w1", "s1", { image: Buffer.from("a"), mime: "image/jpeg", width: 720, height: 1600, at: 1, working: "idle", label: "x" });
    saveSnapshot("w1", "s1", { image: Buffer.from("b"), mime: "image/jpeg", width: 720, height: 1600, at: 2, working: "working", label: "x" });
    expect(readSnapshot("w1", "s1")?.image.toString()).toBe("b");
    expect(snapshotInfo("w1", "s1")).toMatchObject({ at: 2, width: 720, working: "working" });
    expect(readSnapshot("w2", "s1")).toBeNull();
  });

  it("reports viewers only for a short time", () => {
    markViewer("w1", "s1", 1_000);
    expect(hasViewers("w1", "s1", 5_000)).toBe(true);
    expect(hasViewers("w1", "s1", 60_000)).toBe(false);
    expect(hasViewers("w1", "s2", 5_000)).toBe(false);
  });

  it("hands each command to the station once and drops stale ones", () => {
    queueCommand("w1", "s1", { id: "a", type: "home", at: 1_000, by: "u" } as any);
    queueCommand("w1", "s1", { id: "b", type: "back", at: 100_000, by: "u" } as any);
    expect(takeCommands("w1", "s1", 101_000).map((c) => c.id)).toEqual(["b"]);
    expect(takeCommands("w1", "s1", 101_000)).toEqual([]);
  });
});
