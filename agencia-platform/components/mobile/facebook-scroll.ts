import { facebookNodes } from "./facebook-conversation-ui";

/** Keep the gesture inside the list, away from the fixed composer and comment text. */
export function facebookScrollCommand(xml: string, direction: "up" | "down"): string[] {
  const nodes = facebookNodes(xml);
  const list = nodes.filter(node => node.scrollable && node.bounds.bottom - node.bounds.top > 100)
    .sort((a, b) => (b.bounds.bottom - b.bounds.top) - (a.bounds.bottom - a.bounds.top))[0];
  const bounds = list?.bounds ?? {
    left: 0, top: 0,
    right: Math.max(...nodes.map(node => node.bounds.right)),
    bottom: Math.max(...nodes.map(node => node.bounds.bottom)),
  };
  const width = bounds.right - bounds.left;
  const height = bounds.bottom - bounds.top;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error("No se conoce la zona de desplazamiento de Facebook.");
  }
  // A short gesture in the list gutter avoids long-press menus on low-end phones.
  const x = String(Math.round(bounds.left + width * 0.06));
  const upper = Math.round(bounds.top + height * 0.18);
  const lower = Math.round(bounds.top + height * 0.82);
  return ["input", "touchscreen", "swipe", x, String(direction === "down" ? lower : upper), x, String(direction === "down" ? upper : lower), "200"];
}
