import { parseAndroidUiNodes, type AndroidUiNode, type AndroidUiPoint } from "@/components/mobile/android-ui-hierarchy";
import type { PageFollowBatch, PageFollowPlatform, PageFollowTarget } from "@/lib/mobile/page-follow-batch";

export type FollowControlState =
  | { state: "follow"; point: AndroidUiPoint; label: string }
  | { state: "following"; label: string }
  | { state: "missing" };

const FOLLOW_LABELS = ["seguir", "follow", "seguir tambien", "follow back", "seguir pagina", "follow page"];
const FOLLOWING_LABELS: Record<PageFollowPlatform, string[]> = {
  facebook: ["siguiendo", "following", "te gusta", "liked"],
  instagram: ["siguiendo", "following", "solicitado", "requested"],
  tiktok: ["siguiendo", "following", "amigos", "friends", "solicitado", "requested"]
};
const FOLLOW_PREFIXES = ["seguir a ", "follow "];
const FOLLOWING_PREFIXES = ["siguiendo a ", "following "];

function comparable(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim().toLocaleLowerCase("es");
}

function isButtonLike(node: AndroidUiNode): boolean {
  return node.clickable || /Button$/.test(node.className);
}

function matches(node: AndroidUiNode, labels: readonly string[], prefixes: readonly string[]): string | null {
  for (const raw of [node.text, node.contentDescription]) {
    const value = comparable(raw);
    if (!value || /\d/.test(value)) continue; // descarta contadores («120 siguiendo»)
    if (labels.includes(value)) return raw.trim();
    if (prefixes.some((prefix) => value.startsWith(prefix)) && value.length <= 120) return raw.trim();
  }
  return null;
}

/**
 * Localiza el botón principal de seguir en la cabecera de la página/perfil.
 * Solo mira la parte superior de la pantalla para no pulsar sugerencias ni publicaciones.
 */
export function findFollowControl(hierarchy: string, platform: PageFollowPlatform): FollowControlState {
  const nodes = parseAndroidUiNodes(hierarchy);
  if (nodes.length === 0) return { state: "missing" };
  const height = Math.max(...nodes.map((node) => node.bounds.bottom));
  const inHeader = (node: AndroidUiNode) => node.center.y < height * 0.78 && node.center.y > height * 0.06;
  const candidates = nodes.filter(inHeader).sort((a, b) => a.center.y - b.center.y);

  // Primero: ¿ya se sigue? (solo botones, no textos sueltos)
  for (const node of candidates) {
    if (!isButtonLike(node)) continue;
    const label = matches(node, FOLLOWING_LABELS[platform], FOLLOWING_PREFIXES);
    if (label) return { state: "following", label };
  }
  // Botón «Seguir». Si el texto no es pulsable, se pulsa su centro igualmente.
  let fallback: FollowControlState | null = null;
  for (const node of candidates) {
    const label = matches(node, FOLLOW_LABELS, FOLLOW_PREFIXES);
    if (!label) continue;
    if (isButtonLike(node)) return { state: "follow", point: node.center, label };
    fallback ??= { state: "follow", point: node.center, label };
  }
  return fallback ?? { state: "missing" };
}

export type PageFollowRunnerDependencies = {
  openUrl: (url: string) => Promise<void>;
  read: () => Promise<string>;
  tap: (point: AndroidUiPoint) => Promise<void>;
  scrollDown: (hierarchy: string) => Promise<void>;
  wait: (milliseconds: number) => Promise<void>;
  /** Pausa entre páginas (aleatoria) para no hacer ráfagas de seguimientos. */
  pause: () => Promise<void>;
  onProgress?: (batch: PageFollowBatch) => Promise<void> | void;
};

async function followOne(page: PageFollowTarget, platform: PageFollowPlatform, deps: PageFollowRunnerDependencies): Promise<PageFollowTarget> {
  await deps.openUrl(page.url);
  await deps.wait(2_500);
  let hierarchy = await deps.read();
  let control = findFollowControl(hierarchy, platform);
  if (control.state === "missing") {
    // La cabecera puede tardar en cargar o quedar debajo de la portada.
    await deps.wait(1_500);
    hierarchy = await deps.read();
    control = findFollowControl(hierarchy, platform);
  }
  if (control.state === "missing") {
    await deps.scrollDown(hierarchy);
    hierarchy = await deps.read();
    control = findFollowControl(hierarchy, platform);
  }
  if (control.state === "following") return { ...page, outcome: "already_following", detail: `Ya se seguía («${control.label}»).` };
  if (control.state === "missing") {
    return { ...page, outcome: "failed", detail: "No aparece el botón «Seguir». Comprueba que la URL abre la página en la app y que la sesión está iniciada." };
  }
  await deps.tap(control.point);
  await deps.wait(1_800);
  const after = findFollowControl(await deps.read(), platform);
  if (after.state === "following") return { ...page, outcome: "followed", detail: null };
  if (after.state === "follow") {
    return { ...page, outcome: "failed", detail: "Se pulsó «Seguir», pero la app no confirmó el seguimiento. Revisa si pide verificación o hay un límite temporal." };
  }
  // El botón desaparece o cambia a «Mensaje»: la app lo ha aceptado.
  return { ...page, outcome: "followed", detail: "Seguimiento enviado (la app ya no muestra «Seguir»)." };
}

export async function runPageFollowBatch(batch: PageFollowBatch, deps: PageFollowRunnerDependencies): Promise<PageFollowBatch> {
  const pages = [...batch.pages];
  let first = true;
  for (let index = 0; index < pages.length; index += 1) {
    const page = pages[index]!;
    if (page.outcome === "followed" || page.outcome === "already_following") continue;
    if (!first) await deps.pause();
    first = false;
    try {
      pages[index] = await followOne(page, batch.platform, deps);
    } catch (error) {
      pages[index] = { ...page, outcome: "failed", detail: (error instanceof Error ? error.message : "No se pudo abrir la página.").slice(0, 500) };
    }
    await deps.onProgress?.({ ...batch, pages: [...pages] });
  }
  return { ...batch, pages };
}
