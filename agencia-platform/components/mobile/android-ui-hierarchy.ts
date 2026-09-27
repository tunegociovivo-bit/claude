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

type AndroidUiCommandRunner = (command: readonly string[]) => Promise<unknown>;

const ANDROID_UI_DUMP_PATH = "/sdcard/nv-mobile-window.xml";

export async function readAndroidUiHierarchySafely(
  runCommand: AndroidUiCommandRunner
): Promise<string> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const hierarchy = String(await runCommand([
    "sh",
    "-c",
    `rm -f ${ANDROID_UI_DUMP_PATH} && timeout 25 uiautomator dump ${ANDROID_UI_DUMP_PATH} >/dev/null && cat ${ANDROID_UI_DUMP_PATH}`
  ]));
      if (hierarchy.includes("<hierarchy") && hierarchy.includes("</hierarchy>")) return hierarchy;
    } catch {
      // MIUI may fail the first accessibility process during a screen transition.
      // Each attempt removes the old dump and remains bounded on the device.
    }
  }
  throw new Error("Android no ha devuelto la estructura accesible de Facebook tras dos intentos. Espera a que termine de cargar la pantalla y reintenta.");
}

function decodeXmlAttribute(value: string): string {
  return value
    .replace(/&#(x[0-9a-f]+|[0-9]+);/gi, (entity, code: string) => { const point = code.toLowerCase().startsWith("x") ? parseInt(code.slice(1), 16) : Number(code); return point <= 0x10ffff ? String.fromCodePoint(point) : entity; })
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
