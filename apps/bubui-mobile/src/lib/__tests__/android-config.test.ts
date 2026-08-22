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

  it("directs WhatsApp choices to the selected Android package", () => {
    expect(config.plugins).toContain("./plugins/withWhatsAppQueries");
    const patch = readFileSync(resolve(__dirname, "../../../patches/expo-intent-launcher+12.1.5.patch"), "utf8");
    expect(patch).toContain("intent.setPackage(params.packageName)");
  });

  it("keeps the challenge acceptance CTA outside the scrollable content", () => {
    const source = readFileSync(resolve(__dirname, "../../screens/FriendChallengeDetail.tsx"), "utf8");
    const scrollEnd = source.indexOf("</ScrollView>");
    const footer = source.indexOf("styles.stickyFooter");
    expect(scrollEnd).toBeGreaterThan(0);
    expect(footer).toBeGreaterThan(scrollEnd);
  });
});
