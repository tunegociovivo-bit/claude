/** Utilidades de la estación (ordenador con los móviles por USB) para el acceso remoto. */
export type RemoteCommand =
  | { id: string; type: "tap"; x: number; y: number }
  | { id: string; type: "swipe"; x: number; y: number; x2: number; y2: number }
  | { id: string; type: "back" | "home" | "recents" }
  | { id: string; type: "text"; text: string }
  | { id: string; type: "openUrl"; url: string };

/** Reduce la pantalla a JPEG ligero (el canvas debe crearse con captura habilitada). */
export function canvasToJpeg(canvas: HTMLCanvasElement, maxWidth: number, quality = 0.6): string | undefined {
  if (!canvas.width || !canvas.height) return undefined;
  const scale = Math.min(1, maxWidth / canvas.width);
  const target = document.createElement("canvas");
  target.width = Math.max(1, Math.round(canvas.width * scale));
  target.height = Math.max(1, Math.round(canvas.height * scale));
  const context = target.getContext("2d", { alpha: false });
  if (!context) return undefined;
  context.drawImage(canvas, 0, 0, target.width, target.height);
  const url = target.toDataURL("image/jpeg", quality);
  return url.startsWith("data:image/jpeg") ? url : undefined;
}

/** Cada cuánto se envía la pantalla: rápido si alguien la mira, muy de vez en cuando si no. */
export function stationUploadInterval(wanted: boolean) { return wanted ? 1_500 : 20_000; }
