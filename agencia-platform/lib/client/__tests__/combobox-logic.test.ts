/**
 * Contrato FASE 2 · objetivo 3/4 — lógica pura del combobox (recientes,
 * dedupe incremental, navegación por teclado, ventana de virtualización).
 */
import { describe, it, expect } from "vitest";
import {
  mergeDedupe,
  addRecent,
  loadRecents,
  saveRecent,
  nextActiveIndex,
  virtualWindow,
  RECENTS_KEY,
  type ClientOption
} from "../combobox-logic";

const c = (id: string, name = id): ClientOption => ({ id, name, status: "ACTIVE" });

describe("mergeDedupe (carga incremental)", () => {
  it("une páginas sin duplicar por id y preserva orden", () => {
    const r = mergeDedupe([c("a"), c("b")], [c("b"), c("c")]);
    expect(r.map((o) => o.id)).toEqual(["a", "b", "c"]);
  });
});

describe("addRecent", () => {
  it("mueve al frente, deduplica y acota", () => {
    let l = [c("a"), c("b"), c("c")];
    l = addRecent(l, c("c"), 3);
    expect(l.map((o) => o.id)).toEqual(["c", "a", "b"]);
    l = addRecent(l, c("d"), 3);
    expect(l.map((o) => o.id)).toEqual(["d", "c", "a"]); // cap 3
  });
});

describe("recientes persistidos (store inyectable)", () => {
  function memStore() {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
  }
  it("guarda y recupera; ignora JSON corrupto", () => {
    const s = memStore();
    saveRecent(s, c("a"), 6);
    saveRecent(s, c("b"), 6);
    expect(loadRecents(s).map((o) => o.id)).toEqual(["b", "a"]);
    s.setItem(RECENTS_KEY, "no-json{");
    expect(loadRecents(s)).toEqual([]);
  });
  it("sin store → []", () => {
    expect(loadRecents(null)).toEqual([]);
  });
});

describe("nextActiveIndex (teclado)", () => {
  it("baja/sube con wrap y respeta Home/End", () => {
    expect(nextActiveIndex(-1, "ArrowDown", 3)).toBe(0);
    expect(nextActiveIndex(2, "ArrowDown", 3)).toBe(0); // wrap
    expect(nextActiveIndex(0, "ArrowUp", 3)).toBe(2); // wrap
    expect(nextActiveIndex(1, "ArrowUp", 3)).toBe(0);
    expect(nextActiveIndex(1, "Home", 3)).toBe(0);
    expect(nextActiveIndex(1, "End", 3)).toBe(2);
    expect(nextActiveIndex(0, "ArrowDown", 0)).toBe(-1); // lista vacía
  });
});

describe("virtualWindow", () => {
  it("acota el rango renderizado con overscan y calcula padding", () => {
    // 1000 filas de 32px, viewport 320px, scroll a 3200px (fila 100)
    const w = virtualWindow(3200, 32, 320, 1000, 4);
    expect(w.start).toBe(96); // 100 - overscan
    expect(w.end).toBe(114); // 100 + 10 visibles + 4
    expect(w.padTop).toBe(96 * 32);
    expect(w.padBottom).toBe((1000 - 114) * 32);
  });
  it("listas pequeñas → renderiza todo sin padding", () => {
    expect(virtualWindow(0, 32, 320, 5)).toEqual({ start: 0, end: 5, padTop: 0, padBottom: 0 });
  });
});
