import { describe, expect, it } from "vitest";
import { backupFileNames, isMissingStorageObjectError, whichBackupsToday } from "../drive-rotation";

describe("rotación de copias completas en Drive", () => {
  it("usa gzip real y dos slots alternos", () => {
    expect(backupFileNames("daily", new Date("2026-08-14T03:00:00Z")).fileName).toMatch(/daily-[AB]\.json\.gz$/);
    expect(backupFileNames("daily", new Date("2026-08-15T03:00:00Z")).fileName)
      .not.toBe(backupFileNames("daily", new Date("2026-08-14T03:00:00Z")).fileName);
  });

  it("añade semanal el lunes y mensual el día uno", () => {
    expect(whichBackupsToday(new Date("2026-06-01T03:00:00Z"))).toEqual(["daily", "weekly", "monthly"]);
  });

  it("solo tolera objetos de origen realmente ausentes", () => {
    expect(isMissingStorageObjectError({ name: "NoSuchKey" })).toBe(true);
    expect(isMissingStorageObjectError(new Error("The specified key does not exist."))).toBe(true);
    expect(isMissingStorageObjectError(new Error("Connection timed out"))).toBe(false);
  });
});
