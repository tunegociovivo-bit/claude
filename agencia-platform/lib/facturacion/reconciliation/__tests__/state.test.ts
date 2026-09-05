import { describe, expect, it } from "vitest";
import { profileForForcedReconciliation } from "../state";

describe("resincronización bancaria forzada", () => {
  it("elimina el contador y aviso del fallo anterior conservando el resto del perfil", () => {
    expect(profileForForcedReconciliation(
      { account: "masked", retryState: { attempts: 3, lastFailureAt: "2026-08-27", notifiedAt: "2026-08-27" } },
      new Date("2026-09-05T08:00:00.000Z")
    )).toEqual({
      account: "masked",
      forceRequestedAt: "2026-09-05T08:00:00.000Z",
      retryState: { attempts: 0, lastFailureAt: null, notifiedAt: null }
    });
  });
});
