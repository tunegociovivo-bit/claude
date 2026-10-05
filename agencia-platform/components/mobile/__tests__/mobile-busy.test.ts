import { describe, expect, it } from "vitest";
import { beginMobileWork, endMobileWork, isMobileBusy, isNewerBuild } from "../mobile-busy";

describe("recarga por versión nueva", () => {
  it("detecta un build más nuevo", () => {
    expect(isNewerBuild("1000", 2000)).toBe(true);
    expect(isNewerBuild("2000", 2000)).toBe(false);
    expect(isNewerBuild(undefined, 2000)).toBe(false);
  });
  it("espera a que termine el trabajo en curso", () => {
    beginMobileWork(); expect(isMobileBusy()).toBe(true);
    endMobileWork(); expect(isMobileBusy()).toBe(false);
  });
});
