import { describe, expect, it } from "vitest";
import { createPacedDependencies, paceFactor } from "../mobile-pace";

describe("ritmo adaptativo", () => {
  it("alarga las esperas en móviles lentos con un máximo", () => {
    expect(paceFactor(800)).toBe(1);
    expect(paceFactor(3_600)).toBe(3);
    expect(paceFactor(20_000)).toBe(3.5);
  });

  it("mide las lecturas y escala las esperas", async () => {
    let clock = 0;
    const waits: number[] = [];
    const paced = createPacedDependencies({
      read: async () => { clock += 4_800; return "<hierarchy/>"; },
      wait: async (ms: number) => { waits.push(ms); }
    }, () => clock);
    await paced.wait(1_000);
    await paced.read();
    await paced.wait(1_000);
    expect(waits).toEqual([1_500, 3_500]);
  });
});
