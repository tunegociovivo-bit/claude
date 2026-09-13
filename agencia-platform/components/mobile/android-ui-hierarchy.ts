export type AndroidUiPoint = { x: number; y: number };

export type AndroidUiNodeCriteria = {
  labels?: readonly string[];
  className?: string;
  focused?: boolean;
};

function decodeXmlAttribute(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function comparable(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLocaleLowerCase("es");
}

export function findAndroidUiNodeCenter(
  hierarchy: string,
  criteria: AndroidUiNodeCriteria
): AndroidUiPoint | null {
  const labels = (criteria.labels ?? []).map(comparable).filter(Boolean);
  const nodes = hierarchy.match(/<node\b[^>]*\/?\s*>/g) ?? [];

  for (const node of nodes) {
    const attributes = new Map<string, string>();
    for (const match of node.matchAll(/([\w:-]+)="([^"]*)"/g)) {
      attributes.set(match[1], decodeXmlAttribute(match[2]));
    }
    if (criteria.className && attributes.get("class") !== criteria.className) continue;
    if (criteria.focused !== undefined && (attributes.get("focused") === "true") !== criteria.focused) continue;
    if (labels.length) {
      const candidates = [attributes.get("text") ?? "", attributes.get("content-desc") ?? ""]
        .map(comparable);
      if (!labels.some((label) => candidates.some((candidate) => candidate === label || candidate.includes(label)))) {
        continue;
      }
    }

    const bounds = /^\[(\d+),(\d+)]\[(\d+),(\d+)]$/.exec(attributes.get("bounds") ?? "");
    if (!bounds) continue;
    const [, left, top, right, bottom] = bounds.map(Number);
    if (right <= left || bottom <= top) continue;
    return { x: Math.round((left + right) / 2), y: Math.round((top + bottom) / 2) };
  }
  return null;
}
