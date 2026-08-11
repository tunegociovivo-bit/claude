/**
 * Contrato FASE 2 · objetivo 4 — virtualización de altura variable (puro).
 */
import { describe, it, expect } from "vitest";
import { buildOffsets, firstIndexBelow, variableWindow, virtualDisabled } from "../virtual-list";

describe("buildOffsets", () => {
  it("prefix-sum con alto total al final; ignora negativos/NaN", () => {
    expect(buildOffsets([10, 20, 30])).toEqual([0, 10, 30, 60]);
    expect(buildOffsets([10, -5, 30])).toEqual([0, 10, 10, 40]);
  });
});

describe("firstIndexBelow", () => {
  const off = buildOffsets([10, 10, 10, 10]); // [0,10,20,30,40]
  it("encuentra la primera fila cuya base supera y", () => {
    expect(firstIndexBelow(off, 0)).toBe(0);
    expect(firstIndexBelow(off, 9)).toBe(0);
    expect(firstIndexBelow(off, 10)).toBe(1);
    expect(firstIndexBelow(off, 25)).toBe(2);
    expect(firstIndexBelow(off, 100)).toBe(4);
  });
});

describe("variableWindow", () => {
  it("filas iguales: rango con overscan y padding correctos", () => {
    const off = buildOffsets(new Array(1000).fill(20)); // total 20000
    const w = variableWindow(off, 2000, 200, 4); // scroll fila 100, 10 visibles
    expect(w.start).toBe(96); // 100 - 4
    expect(w.end).toBe(115); // (100 + 10 + 1) + 4
    expect(w.padTop).toBe(off[w.start]);
    expect(w.padBottom).toBe(20000 - off[w.end]);
    // padTop + ventana + padBottom = alto total
    const windowH = off[w.end] - off[w.start];
    expect(w.padTop + windowH + w.padBottom).toBe(20000);
  });

  it("alturas variables: usa offsets reales, no una fija", () => {
    const heights = [100, 50, 200, 30, 300, 40]; // total 720
    const off = buildOffsets(heights); // [0,100,150,350,380,680,720]
    const w = variableWindow(off, 160, 100, 0); // ver desde y=160 (fila 2) alto 100 → hasta y=260 (fila 2)
    expect(w.start).toBe(2);
    expect(w.padTop).toBe(150); // top real de la fila 2 (offsets[2])
    expect(w.padTop + (off[w.end] - off[w.start]) + w.padBottom).toBe(720);
  });

  it("lista vacía → rango vacío", () => {
    expect(variableWindow(buildOffsets([]), 0, 100)).toEqual({ start: 0, end: 0, padTop: 0, padBottom: 0 });
  });
});

describe("virtualDisabled", () => {
  it("false por defecto (sin env ni localStorage)", () => {
    expect(virtualDisabled()).toBe(false);
  });
});
