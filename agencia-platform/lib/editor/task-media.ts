export const TASK_MEDIA_NODE = "taskMedia";
export const TASK_MEDIA_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "video/mp4",
  "video/webm"
]);

export type TaskMediaKind = "image" | "video";

export type TaskMediaAttrs = {
  fileId: string;
  kind: TaskMediaKind;
  name?: string;
  mimeType?: string;
  alt?: string;
};

export function extractTaskMediaFileIds(description?: string | null): string[] {
  if (!description || description.length > 2_000_000) return [];
  let doc: unknown;
  try {
    doc = JSON.parse(description);
  } catch {
    return [];
  }
  const ids = new Set<string>();
  let visited = 0;
  const visit = (value: unknown, depth: number) => {
    if (depth > 40 || ++visited > 20_000 || !value || typeof value !== "object") return;
    const node = value as Record<string, unknown>;
    if (node.type === TASK_MEDIA_NODE) {
      const attrs = node.attrs as Record<string, unknown> | undefined;
      if (typeof attrs?.fileId === "string" && attrs.fileId.length <= 128) ids.add(attrs.fileId);
    }
    if (Array.isArray(node.content)) node.content.forEach((child) => visit(child, depth + 1));
  };
  visit(doc, 0);
  return [...ids];
}

export function mediaKindForMime(mimeType: string): TaskMediaKind | null {
  if (!TASK_MEDIA_MIME_TYPES.has(mimeType)) return null;
  return mimeType.startsWith("image/") ? "image" : "video";
}
