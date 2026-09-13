export type AndroidUiPoint = { x: number; y: number };

export type AndroidUiNode = {
  text: string;
  contentDescription: string;
  packageName: string;
  resourceId: string;
  className: string;
  clickable: boolean;
  focused: boolean;
  checked: boolean;
  bounds: { left: number; top: number; right: number; bottom: number };
  center: AndroidUiPoint;
};

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
  for (const node of parseAndroidUiNodes(hierarchy)) {
    if (criteria.className && node.className !== criteria.className) continue;
    if (criteria.focused !== undefined && node.focused !== criteria.focused) continue;
    if (labels.length) {
      const candidates = [node.text, node.contentDescription].map(comparable);
      if (!labels.some((label) => candidates.some((candidate) => candidate === label || candidate.includes(label)))) {
        continue;
      }
    }
    return node.center;
  }
  return null;
}

export function parseAndroidUiNodes(hierarchy: string): AndroidUiNode[] {
  const nodes = hierarchy.match(/<node\b[^>]*\/?\s*>/g) ?? [];
  const parsedNodes: AndroidUiNode[] = [];

  for (const node of nodes) {
    const attributes = new Map<string, string>();
    for (const match of node.matchAll(/([\w:-]+)="([^"]*)"/g)) {
      attributes.set(match[1], decodeXmlAttribute(match[2]));
    }
    const bounds = /^\[(\d+),(\d+)]\[(\d+),(\d+)]$/.exec(attributes.get("bounds") ?? "");
    if (!bounds) continue;
    const [, left, top, right, bottom] = bounds.map(Number);
    if (right <= left || bottom <= top) continue;
    parsedNodes.push({
      text: attributes.get("text") ?? "",
      contentDescription: attributes.get("content-desc") ?? "",
      packageName: attributes.get("package") ?? "",
      resourceId: attributes.get("resource-id") ?? "",
      className: attributes.get("class") ?? "",
      clickable: attributes.get("clickable") === "true",
      focused: attributes.get("focused") === "true",
      checked: attributes.get("checked") === "true",
      bounds: { left, top, right, bottom },
      center: { x: Math.round((left + right) / 2), y: Math.round((top + bottom) / 2) }
    });
  }
  return parsedNodes;
}
