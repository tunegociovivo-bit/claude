import { parseAndroidUiNodes, type AndroidUiPoint } from "@/components/mobile/android-ui-hierarchy";
import { facebookNodes, namedControl, nodeText, screenSignature, visibleComments, visiblePostComments } from "@/components/mobile/facebook-conversation-ui";
import { normalizeFacebookText } from "@/lib/mobile/facebook-conversations";
import type { CommentThreadMessage } from "@/lib/mobile/comment-thread";

export type CommentThreadRunnerDependencies = {
  openUrl: (url: string) => Promise<void>;
  read: () => Promise<string>;
  tap: (point: AndroidUiPoint) => Promise<void>;
  scroll: (xml: string, direction: "up" | "down") => Promise<void>;
  paste: (text: string) => Promise<void>;
  wait: (ms: number) => Promise<void>;
};

const COMPOSER = /EditText|AutoCompleteTextView/;
const SEND = /^(Enviar|Publicar|Send|Post)( comentario| respuesta)?$/i;
/** Botón «Comentar» de la publicación (texto o content-desc, con o sin sufijos de accesibilidad). */
const COMMENT_BUTTON = /^(Comentar|Comment)(\b|[,.])/i;
/** Barra «Escribe un comentario…» que aún no es un EditText hasta que se toca. */
const COMPOSER_PLACEHOLDER = /^(Escribe un comentario|Escribe una respuesta|Write a comment|Write a reply|Comentar como|Comment as|Responder como|Reply as)/i;

function snippet(text: string): string {
  return normalizeFacebookText(text).slice(0, 60);
}

/**
 * uiautomator falla si la pantalla no está quieta (vídeos en reproducción de anuncios,
 * animaciones). Reintentamos con pausas antes de rendirnos.
 */
async function readStable(deps: CommentThreadRunnerDependencies, attempts = 4): Promise<string> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try { return await deps.read(); }
    catch (error) { lastError = error; await deps.wait(1_200 + attempt * 600); }
  }
  throw lastError instanceof Error ? lastError : new Error("Android no ha devuelto la estructura de la pantalla.");
}

function composerNode(xml: string, reply: boolean) {
  const editors = facebookNodes(xml).filter((node) => COMPOSER.test(node.className));
  return editors.find((node) => (reply ? /respon|respu|reply/i : /coment|comment|respon|reply/i).test(`${node.text} ${node.contentDescription}`))
    ?? editors[0];
}

function placeholderNode(xml: string) {
  return facebookNodes(xml).find((node) => !COMPOSER.test(node.className) && COMPOSER_PLACEHOLDER.test(nodeText(node)));
}

function commentButton(xml: string) {
  return facebookNodes(xml).filter((node) => COMMENT_BUTTON.test(nodeText(node)) && !/\d/.test(nodeText(node).slice(0, 3)))
    .sort((a, b) => Number(b.clickable) - Number(a.clickable))[0];
}

/** Resumen de lo que hay en pantalla para que el error sea diagnosticable desde el Hub. */
function screenSummary(xml: string): string {
  const nodes = parseAndroidUiNodes(xml);
  const packages = [...new Set(nodes.map((node) => node.packageName).filter(Boolean))].slice(0, 3).join(", ");
  const labels = [...new Set(nodes.filter((node) => node.clickable).map((node) => (node.text || node.contentDescription).trim()).filter(Boolean))].slice(0, 12).join(" | ");
  return `App en pantalla: ${packages || "desconocida"}. Botones visibles: ${labels || "ninguno"}`.slice(0, 400);
}

/** Deja la pantalla con el campo de escribir comentario (EditText) visible. */
async function revealComposer(deps: CommentThreadRunnerDependencies): Promise<string> {
  let xml = await readStable(deps);
  for (let step = 0; step < 4; step++) {
    if (composerNode(xml, false)) return xml;
    const placeholder = placeholderNode(xml);
    if (placeholder) { await deps.tap(placeholder.center); await deps.wait(1_000); xml = await readStable(deps); continue; }
    const button = commentButton(xml) ?? (visiblePostComments(xml)[0] ? { center: visiblePostComments(xml)[0]!.point } : undefined);
    if (button) { await deps.tap(button.center); await deps.wait(1_500); xml = await readStable(deps); continue; }
    // El botón «Comentar» puede quedar por debajo de un vídeo o imagen alta.
    await deps.scroll(xml, "down");
    xml = await readStable(deps);
  }
  return xml;
}

async function locateParent(message: CommentThreadMessage, deps: CommentThreadRunnerDependencies) {
  const wanted = snippet(message.replyToText ?? "");
  if (!wanted) throw new Error("La respuesta no conoce el texto del comentario original.");
  let xml = await readStable(deps);
  if (!visibleComments(xml).length) {
    const button = commentButton(xml) ?? (visiblePostComments(xml)[0] ? { center: visiblePostComments(xml)[0]!.point } : undefined);
    if (button) { await deps.tap(button.center); await deps.wait(1_500); xml = await readStable(deps); }
  }
  let previous = "";
  for (let screen = 0; screen < 12; screen++) {
    const match = visibleComments(xml).find((comment) => normalizeFacebookText(comment.text).includes(wanted.slice(0, 40)));
    if (match) return match;
    const more = namedControl(xml, /^(Ver más comentarios|Ver comentarios anteriores|View more comments|View previous comments)/i);
    if (more) { await deps.tap(more.center); await deps.wait(1_200); xml = await readStable(deps); continue; }
    const signature = screenSignature(xml);
    if (signature === previous) break;
    previous = signature;
    await deps.scroll(xml, "down");
    xml = await readStable(deps);
  }
  throw new Error(`No se encuentra en la publicación el comentario de ${message.replyToAuthor ?? "la otra cuenta"} al que hay que responder. No se ha publicado nada. ${screenSummary(xml)}`);
}

/**
 * Publica un único mensaje aprobado: comentario nuevo o respuesta a un comentario
 * ya publicado. Todo lo que ocurre ANTES de pulsar Enviar puede fallar y reintentarse
 * sin riesgo. Lo que ocurre DESPUÉS nunca lanza error: si no se puede confirmar,
 * se deja «en revisión» para no duplicar el comentario.
 */
export async function postCommentThreadMessage(message: CommentThreadMessage, deps: CommentThreadRunnerDependencies): Promise<CommentThreadMessage> {
  await deps.openUrl(message.postUrl);
  await deps.wait(3_000);
  let xml: string;
  if (message.mode === "reply") {
    const parent = await locateParent(message, deps);
    await deps.tap(parent.point);
    await deps.wait(1_000);
    xml = await readStable(deps);
  } else {
    xml = await revealComposer(deps);
  }
  const composer = composerNode(xml, message.mode === "reply");
  if (!composer) throw new Error(`Facebook no ha mostrado el campo para escribir el comentario. No se ha publicado nada. ${screenSummary(xml)}`);
  await deps.tap(composer.center);
  await deps.wait(600);
  await deps.paste(message.text);
  await deps.wait(700);
  xml = await readStable(deps);
  const filled = facebookNodes(xml).some((node) => COMPOSER.test(node.className) && normalizeFacebookText(node.text).includes(snippet(message.text).slice(0, 30)));
  const send = namedControl(xml, SEND);
  if (!filled || !send) throw new Error(`No se ha podido verificar el texto escrito o el botón de enviar. No se ha publicado nada. ${screenSummary(xml)}`);

  // A partir de aquí el comentario puede estar publicado: nada puede lanzar error.
  try { await deps.tap(send.center); }
  catch { return { ...message, outcome: "review", detail: "No se pudo confirmar la pulsación de Enviar. Revisa la publicación y marca el mensaje como publicado si aparece." }; }
  let shown = false;
  for (let attempt = 0; attempt < 3 && !shown; attempt++) {
    await deps.wait(1_800);
    try {
      const after = await deps.read();
      shown = facebookNodes(after).some((node) => !COMPOSER.test(node.className) && normalizeFacebookText(nodeText(node)).includes(snippet(message.text).slice(0, 30)));
    } catch { /* pantalla en movimiento: se reintenta la comprobación */ }
  }
  return shown
    ? { ...message, outcome: "sent", detail: "Mensaje visible en Facebook." }
    : { ...message, outcome: "review", detail: "Se pulsó Enviar pero no se ha podido confirmar. Revisa la publicación y pulsa «Confirmo que está publicado» para continuar la conversación." };
}
