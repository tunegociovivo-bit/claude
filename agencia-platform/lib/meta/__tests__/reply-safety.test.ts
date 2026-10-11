import { describe, expect, it } from "vitest";
import { expandShortLinks, isMetaIntegrityBlock, looksLikeShortLink, resolveFinalUrl } from "../reply-safety";
import { replyPacingMs, runPacedSequence } from "../bulk-moderation";

function fakeFetch(map: Record<string, { status: number; location?: string }>): typeof fetch {
  return (async (input: any) => {
    const hit = map[String(input)] ?? { status: 200 };
    return new Response(null, { status: hit.status, headers: hit.location ? { location: hit.location } : {} });
  }) as typeof fetch;
}

describe("enlaces acortados en respuestas", () => {
  it("reconoce acortadores conocidos y de marca", () => {
    expect(looksLikeShortLink("https://eros.ki/fnqcslc")).toBe(true);
    expect(looksLikeShortLink("https://bit.ly/abc123")).toBe(true);
    expect(looksLikeShortLink("https://franquicias.eroski.es/franquicias/")).toBe(false);
  });

  it("sustituye el enlace acortado por su destino final", async () => {
    const fetchImpl = fakeFetch({
      "https://eros.ki/fnqcslc": { status: 301, location: "https://franquicias.eroski.es/franquicias/?utm_source=meta" },
      "https://franquicias.eroski.es/franquicias/?utm_source=meta": { status: 200 }
    });
    const result = await expandShortLinks("Visita https://eros.ki/fnqcslc. Un saludo.", fetchImpl);
    expect(result.message).toBe("Visita https://franquicias.eroski.es/franquicias/?utm_source=meta. Un saludo.");
    expect(result.replaced).toHaveLength(1);
  });

  it("deja el texto igual si el enlace no redirige o falla", async () => {
    expect((await expandShortLinks("Info en https://eros.ki/abcd", fakeFetch({}))).message).toBe("Info en https://eros.ki/abcd");
    const failing = (async () => { throw new Error("red"); }) as unknown as typeof fetch;
    expect((await expandShortLinks("Info en https://eros.ki/abcd", failing)).message).toBe("Info en https://eros.ki/abcd");
  });

  it("no sigue redirecciones hacia la red interna", async () => {
    expect(await resolveFinalUrl("https://eros.ki/x1y2", fakeFetch({ "https://eros.ki/x1y2": { status: 302, location: "http://127.0.0.1/admin" } }))).toBeNull();
  });
});

describe("bloqueos antispam de Meta", () => {
  it("detecta el bloqueo Browser Locker y el código 368", () => {
    expect(isMetaIntegrityBlock({ message: "Meta 400 en 123/comments: Breaking Browser Locker Behavior detected" })).toBe(true);
    expect(isMetaIntegrityBlock({ code: 368, message: "x" })).toBe(true);
    expect(isMetaIntegrityBlock({ message: "Meta 500 en 123/comments: An unknown error occurred" })).toBe(false);
  });
});

describe("publicación en bloque con pausas", () => {
  it("espera entre 15 y 30 s entre respuestas", () => {
    expect(replyPacingMs(() => 0)).toBe(15_000);
    expect(replyPacingMs(() => 1)).toBe(30_000);
  });

  it("se detiene al primer bloqueo y no publica el resto", async () => {
    const published: number[] = [];
    const { results, stoppedAt } = await runPacedSequence([1, 2, 3, 4], async (n) => { published.push(n); return { blocked: n === 2 }; }, {
      pauseMs: () => 0, shouldStop: (r) => r.blocked, sleep: async () => {}
    });
    expect(published).toEqual([1, 2]);
    expect(stoppedAt).toBe(1);
    expect(results).toHaveLength(2);
  });
});
