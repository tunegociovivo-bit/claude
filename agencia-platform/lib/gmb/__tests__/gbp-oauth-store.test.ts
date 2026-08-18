/**
 * Store de nonces one-time del OAuth GBP: registro, consumo atómico (un solo uso),
 * anti-replay, expiración y aislamiento por tenant. Prisma en memoria (sin BD).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { prisma } = vi.hoisted(() => {
  const rows: any[] = [];
  const prismaObj: any = {
    _rows: rows,
    gmbOAuthState: {
      create: vi.fn(async ({ data }: any) => {
        const row = { id: `s${rows.length + 1}`, usedAt: null, ...data };
        rows.push(row);
        return { ...row };
      }),
      // updateMany atómico: solo afecta filas que cumplen TODAS las condiciones.
      updateMany: vi.fn(async ({ where, data }: any) => {
        let count = 0;
        for (const r of rows) {
          if (r.nonce !== where.nonce) continue;
          if (r.workspaceId !== where.workspaceId) continue;
          if (r.userId !== where.userId) continue;
          if (where.usedAt === null && r.usedAt !== null) continue;
          if (where.expiresAt?.gt && !(r.expiresAt > where.expiresAt.gt)) continue;
          Object.assign(r, data);
          count++;
        }
        return { count };
      }),
      deleteMany: vi.fn(async ({ where }: any) => {
        let count = 0;
        for (let i = rows.length - 1; i >= 0; i--) {
          if (where.expiresAt?.lt && rows[i].expiresAt < where.expiresAt.lt) {
            rows.splice(i, 1);
            count++;
          }
        }
        return { count };
      }),
    },
  };
  return { prisma: prismaObj };
});
vi.mock("@/lib/db/prisma", () => ({ prisma }));

import { registerNonce, consumeNonce, purgeExpiredNonces } from "../gbp-oauth-store";

beforeEach(() => {
  prisma._rows.length = 0;
});

describe("nonce one-time", () => {
  const who = { nonce: "n-1", workspaceId: "ws1", userId: "u1" };

  it("consume una vez y falla la segunda (anti-replay)", async () => {
    await registerNonce({ ...who, now: 1000 });
    expect(await consumeNonce({ ...who, now: 2000 })).toBe(true);
    expect(await consumeNonce({ ...who, now: 3000 })).toBe(false);
  });

  it("rechaza nonce inexistente", async () => {
    expect(await consumeNonce({ nonce: "ghost", workspaceId: "ws1", userId: "u1", now: 1000 })).toBe(false);
  });

  it("rechaza consumo tras expirar", async () => {
    await registerNonce({ ...who, now: 1000 }); // expira a 1000 + TTL
    const late = 1000 + 11 * 60 * 1000;
    expect(await consumeNonce({ ...who, now: late })).toBe(false);
  });

  it("aísla por tenant: otro workspace no puede consumir el nonce", async () => {
    await registerNonce({ ...who, now: 1000 });
    expect(await consumeNonce({ nonce: "n-1", workspaceId: "ws2", userId: "u1", now: 2000 })).toBe(false);
    // el legítimo sigue disponible
    expect(await consumeNonce({ ...who, now: 2500 })).toBe(true);
  });

  it("aísla por usuario", async () => {
    await registerNonce({ ...who, now: 1000 });
    expect(await consumeNonce({ nonce: "n-1", workspaceId: "ws1", userId: "u2", now: 2000 })).toBe(false);
  });

  it("purga los caducados", async () => {
    await registerNonce({ nonce: "a", workspaceId: "ws1", userId: "u1", now: 1000 });
    await registerNonce({ nonce: "b", workspaceId: "ws1", userId: "u1", now: 1000 });
    const later = 1000 + 20 * 60 * 1000;
    expect(await purgeExpiredNonces(later)).toBe(2);
    expect(prisma._rows.length).toBe(0);
  });
});
