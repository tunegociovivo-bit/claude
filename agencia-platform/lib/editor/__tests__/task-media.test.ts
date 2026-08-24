import { describe, expect, it } from "vitest";
import { extractTaskMediaFileIds, mediaKindForMime } from "../task-media";

describe("task media document helpers", () => {
  it("extracts and deduplicates stable file ids from nested TipTap content", () => {
    const description = JSON.stringify({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Destino" }] },
        { type: "taskMedia", attrs: { fileId: "file-1", kind: "image" } },
        { type: "blockquote", content: [{ type: "taskMedia", attrs: { fileId: "file-1", kind: "video" } }] },
        { type: "taskMedia", attrs: { fileId: "file-2", kind: "video" } }
      ]
    });
    expect(extractTaskMediaFileIds(description)).toEqual(["file-1", "file-2"]);
  });

  it("ignores plain text, malformed documents and legacy image URLs", () => {
    expect(extractTaskMediaFileIds("texto normal")).toEqual([]);
    expect(extractTaskMediaFileIds("{" )).toEqual([]);
    expect(extractTaskMediaFileIds(JSON.stringify({ type: "doc", content: [{ type: "image", attrs: { src: "https://example.test/a.jpg" } }] }))).toEqual([]);
  });

  it("derives media kind only for the upload allowlist", () => {
    expect(mediaKindForMime("image/webp")).toBe("image");
    expect(mediaKindForMime("video/mp4")).toBe("video");
    expect(mediaKindForMime("image/svg+xml")).toBeNull();
    expect(mediaKindForMime("text/html")).toBeNull();
  });
});
