import { describe, expect, it } from "vitest";
import { describeJobsInboxFailure } from "../sources/jobs-inbox-status";

describe("describeJobsInboxFailure", () => {
  it("turns rejected Gmail credentials into an actionable diagnosis", () => {
    expect(describeJobsInboxFailure({ authenticationFailed: true, message: "Command failed" })).toEqual({
      code: "gmail_auth_rejected",
      message: "Google ha rechazado la credencial del buzón. Vuelve a conectar la cuenta de Google; las alertas automáticas quedan detenidas hasta recuperar el acceso."
    });
  });

  it("does not leak provider error details", () => {
    expect(describeJobsInboxFailure({ message: "LOGIN failed secret-token" }).message).not.toContain("secret-token");
  });
});
