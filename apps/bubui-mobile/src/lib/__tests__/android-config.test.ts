import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const config = JSON.parse(readFileSync(resolve(__dirname, "../../../app.json"), "utf8")).expo;

describe("Android clean-install challenge configuration", () => {
  it("registers verified app links for /reto", () => {
    const links = config.android.intentFilters.flatMap((filter: any) => filter.data ?? []);
    expect(links).toEqual(expect.arrayContaining([
      expect.objectContaining({ scheme: "https", host: "bubui.app", pathPrefix: "/reto" }),
      expect.objectContaining({ scheme: "https", host: "www.bubui.app", pathPrefix: "/reto" })
    ]));
  });

  it("disables Android Auto Backup so an uninstall cannot restore stale attribution", () => {
    expect(config.plugins).toContain("./plugins/withDisableAndroidBackup");
  });
});
