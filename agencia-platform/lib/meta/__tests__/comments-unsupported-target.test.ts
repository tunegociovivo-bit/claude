import { describe, expect, it } from "vitest";
import { isSkippableMetaCommentTargetError } from "../comments";

describe("Meta unsupported comment targets", () => {
  it("aísla publicaciones que Meta anuncia pero no permite consultar por GET", () => {
    expect(isSkippableMetaCommentTargetError({ status: 400, message: "Unsupported request - method type: get" })).toBe(true);
  });

  it("no oculta errores de permisos o fallos transitorios", () => {
    expect(isSkippableMetaCommentTargetError({ status: 403, message: "Missing pages_read_engagement" })).toBe(false);
    expect(isSkippableMetaCommentTargetError({ status: 500, message: "Please reduce the amount of data" })).toBe(false);
  });
});
