import { describe, expect, it } from "vitest";
import { findFollowControl, runPageFollowBatch } from "../page-follow-runner";
import { createPageFollowBatch } from "@/lib/mobile/page-follow-batch";

function screen(nodes: Array<{ text?: string; desc?: string; clickable?: boolean; y: number; cls?: string }>) {
  const body = nodes.map((node) => `<node text="${node.text ?? ""}" content-desc="${node.desc ?? ""}" package="com.facebook.katana" resource-id="" class="${node.cls ?? "android.view.ViewGroup"}" clickable="${node.clickable ?? false}" focused="false" checked="false" bounds="[0,${node.y}][1080,${node.y + 80}]" />`).join("");
  return `<hierarchy><node text="" content-desc="" package="com.facebook.katana" class="android.widget.FrameLayout" clickable="false" focused="false" checked="false" bounds="[0,0][1080,2400]">${body}</node></hierarchy>`;
}

describe("detección del botón Seguir", () => {
  it("encuentra el botón de la cabecera y no los contadores", () => {
    const xml = screen([{ text: "1.234 seguidores", y: 500 }, { desc: "Seguir", clickable: true, y: 700 }, { desc: "Seguir", clickable: true, y: 2100 }]);
    expect(findFollowControl(xml, "facebook")).toMatchObject({ state: "follow", point: { y: 740 } });
  });

  it("reconoce que ya se sigue", () => {
    expect(findFollowControl(screen([{ text: "Siguiendo", clickable: true, y: 700 }]), "instagram").state).toBe("following");
    expect(findFollowControl(screen([{ text: "120", y: 600 }, { text: "Siguiendo", y: 650 }, { text: "Seguir", clickable: true, y: 800 }]), "tiktok").state).toBe("follow");
  });

  it("no confunde «Amigos» de Facebook con seguir", () => {
    expect(findFollowControl(screen([{ text: "Amigos", clickable: true, y: 900 }]), "facebook").state).toBe("missing");
  });
});

describe("ejecución del lote", () => {
  it("sigue, omite las ya seguidas y marca las que fallan", async () => {
    const batch = createPageFollowBatch("facebook", ["https://www.facebook.com/a", "https://www.facebook.com/b", "https://www.facebook.com/c"]);
    const screens: Record<string, string[]> = {
      a: [screen([{ desc: "Seguir", clickable: true, y: 700 }]), screen([{ desc: "Siguiendo", clickable: true, y: 700 }])],
      b: [screen([{ desc: "Siguiendo", clickable: true, y: 700 }])],
      c: [screen([]), screen([]), screen([])]
    };
    let current = "a";
    const taps: number[] = [];
    let pauses = 0;
    const result = await runPageFollowBatch(batch, {
      openUrl: async (url) => { current = url.slice(-1); },
      read: async () => screens[current]!.shift() ?? screen([]),
      tap: async (point) => { taps.push(point.y); },
      scrollDown: async () => {},
      wait: async () => {},
      pause: async () => { pauses += 1; }
    });
    expect(result.pages.map((page) => page.outcome)).toEqual(["followed", "already_following", "failed"]);
    expect(taps).toHaveLength(1);
    expect(pauses).toBe(2);
  });

  it("en el reintento no repite las ya seguidas", async () => {
    const batch = createPageFollowBatch("facebook", ["https://www.facebook.com/a"]);
    batch.pages[0]!.outcome = "followed";
    let opened = 0;
    await runPageFollowBatch(batch, { openUrl: async () => { opened += 1; }, read: async () => "", tap: async () => {}, scrollDown: async () => {}, wait: async () => {}, pause: async () => {} });
    expect(opened).toBe(0);
  });
});
