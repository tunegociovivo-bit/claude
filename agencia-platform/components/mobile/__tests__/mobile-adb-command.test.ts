import { describe, expect, it } from "vitest";
import { escapeAdbCommand } from "@/components/mobile/mobile-adb-command";

describe("escapeAdbCommand", () => {
  it("keeps a URL with Android shell metacharacters inside one quoted argument", () => {
    expect(escapeAdbCommand([
      "am",
      "start",
      "-d",
      "https://example.com/path?a=1&b=2;reboot 'quoted'"
    ])).toEqual([
      "'am'",
      "'start'",
      "'-d'",
      "'https://example.com/path?a=1&b=2;reboot '\\''quoted'\\'''"
    ]);
  });
});
