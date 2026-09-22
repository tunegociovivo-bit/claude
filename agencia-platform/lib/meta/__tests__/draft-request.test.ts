import { expect, it, vi } from "vitest";
import { requestDraftBatch } from "../draft-request";

it("waits for the Hub rate limit and retries the same batch", async () => {
  const request = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ error: "rate_limited", message: "Espera 5s" }), { status: 429, headers: { "Retry-After": "5" } })).mockResolvedValueOnce(new Response(JSON.stringify({ drafts: { a: "Respuesta" } })));
  const sleep = vi.fn().mockResolvedValue(undefined);
  const wait = vi.fn();
  expect(await requestDraftBatch(["a"], wait, request, sleep)).toEqual({ drafts: { a: "Respuesta" } });
  expect(wait).toHaveBeenCalledWith(5);
  expect(sleep).toHaveBeenCalledWith(5250);
  expect(request.mock.calls[0][1].body).toBe(request.mock.calls[1][1].body);
});

it("preserves the actual top-level error instead of blaming AI", async () => {
  const request = vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: "Sesión caducada" }), { status: 401 }));
  await expect(requestDraftBatch(["a"], vi.fn(), request)).rejects.toThrow("Sesión caducada");
  expect(request).toHaveBeenCalledTimes(1);
});
