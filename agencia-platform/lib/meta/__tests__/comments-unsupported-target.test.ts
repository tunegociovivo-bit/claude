import { describe, expect, it } from "vitest";
import { isMetaApplicationRateLimitError, isSkippableMetaCommentTargetError } from "../comments";

describe("Meta unsupported comment targets", () => {
  it("aísla publicaciones que Meta anuncia pero no permite consultar por GET", () => {
    expect(isSkippableMetaCommentTargetError({ status: 400, message: "Unsupported request - method type: get" })).toBe(true);
    expect(isSkippableMetaCommentTargetError({
      status: 400,
      message: "Meta 400 en 132591756789822_1409948527823895/comments: Unsupported get request. Object with ID '132591756789822_1409948527823895' does not exist, cannot be loaded due to missing permissions, or does not support this operation."
    })).toBe(true);
  });

  it("no oculta errores de permisos o fallos transitorios", () => {
    expect(isSkippableMetaCommentTargetError({ status: 403, message: "Missing pages_read_engagement" })).toBe(false);
    expect(isSkippableMetaCommentTargetError({ status: 500, message: "Please reduce the amount of data" })).toBe(false);
  });
});

describe("Meta application rate limits", () => {
  it("identifica el código 4 y su variante textual para aplazar sin alertas falsas", () => {
    expect(isMetaApplicationRateLimitError({ status: 403, code: 4, message: "Application request limit reached" })).toBe(true);
    expect(isMetaApplicationRateLimitError({ status: 403, message: "Meta 403: (#4) Application request limit reached" })).toBe(true);
    expect(isMetaApplicationRateLimitError({ status: 403, code: 10, message: "Missing permission" })).toBe(false);
  });
});
