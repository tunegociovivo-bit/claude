import { beforeEach, describe, expect, it, vi } from "vitest";
const mocked = vi.hoisted(() => ({ findMany: vi.fn(), create: vi.fn(), downloadBuffer: vi.fn() }));
vi.mock("@/lib/db/prisma", () => ({ prisma: { editorialMediaVersion: { findMany: mocked.findMany, create: mocked.create } } }));
vi.mock("@/lib/storage/r2", () => ({ downloadBuffer: mocked.downloadBuffer, buildS3Key: vi.fn(), isStorageEnabled: vi.fn(), signedDownloadUrl: vi.fn(), uploadBuffer: vi.fn() }));
import { getLatestEditorialImageBuffer } from "../media";

describe("selected editorial image", () => {
  beforeEach(() => vi.clearAllMocks());
  it("edits the restored original instead of the newest generated version", async () => {
    mocked.findMany.mockResolvedValue([
      { url: "https://cdn.test/new.png", s3Key: "new" },
      { url: "https://cdn.test/original.png?signature=old", s3Key: "original" }
    ]);
    mocked.downloadBuffer.mockResolvedValue(Buffer.from("original"));
    await getLatestEditorialImageBuffer({ postId: "p", workspaceId: "w", fallbackUrl: "https://cdn.test/original.png?signature=fresh" });
    expect(mocked.downloadBuffer).toHaveBeenCalledWith("original");
  });
  it("never downloads an arbitrary fallback URL", async () => {
    mocked.findMany.mockResolvedValue([]);
    await expect(getLatestEditorialImageBuffer({ postId: "p", workspaceId: "w", fallbackUrl: "http://169.254.169.254/latest/meta-data" })).rejects.toThrow("Sube la imagen");
    expect(mocked.downloadBuffer).not.toHaveBeenCalled();
  });
});
