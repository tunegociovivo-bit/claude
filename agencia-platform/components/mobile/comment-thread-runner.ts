import { parseAndroidUiNodes, type AndroidUiPoint } from "@/components/mobile/android-ui-hierarchy";
import { collapsedReplyPreviews, facebookNodes, namedControl, nodeText, screenSignature, visibleComments, visiblePostComments } from "@/components/mobile/facebook-conversation-ui";
import { normalizeFacebookText } from "@/lib/mobile/facebook-conversations";
import type { CommentThreadMessage } from "@/lib/mobile/comment-thread";
import { APP_LABELS, findAppChooserTarget } from "@/components/mobile/android-app-chooser";
import { MobileJobAbortedError } from "@/components/mobile/mobile-job-guard";

export type CommentThreadRunnerDependencies = {
  openUrl: (url: string) => Promise<void>;
  read: () => Promise<string>;
  tap: (point: AndroidUiPoint) => Promise<void>;
  scroll: (xml: string, direction: "up" | "down") => Promise<void>;
  paste: (text: string) => Promise<void>;
  back: () => Promise<void>;
  wait: (ms: number) => Promise<void>;
  beforeSend: () => Promise<void>;
};

const COMPOSER = /EditText|AutoCompleteTextView/;
const SEND = /^(Enviar|Publicar|Send|Post)( comentario| respuesta)?$/i;
/** Botón «Comentar» de la publicación (texto o content-desc, con o sin sufijos de accesibilidad). */
const COMMENT_BUTTON = /^(Comentar|Comment|Añadir un comentario|Añade un comentario|Add a comment)(\b|[,.])/i;
const COMMENT_ENTRY = /^(Comentar|Comment)(\b|[,.])/i;
// On a known reel the comments counter itself opens the thread. Unlike feed
// discovery, this does not require a post caption above the counter: reel
// captions can sit below the vertical action rail.
const COMMENT_COUNTER = /^(?:(?:Ver (?:los )?|View )?\d+[\d., milk]* (?:comentarios?|comments?))(?:[.,].*)?$/i;
/** Barra «Escribe un comentario…» que aún no es un EditText hasta que se toca. */
const COMPOSER_PLACEHOLDER = /^(Escribe un comentario|Añade un comentario|Añadir un comentario|Add a comment|Escribe una respuesta|Write a comment|Write a reply|Comentar como|Comment as|Responder como|Reply as)/i;

/**
 * uiautomator falla si la pantalla no está quieta (vídeos en reproducción de anuncios,
 * animaciones). Reintentamos con pausas antes de rendirnos.
 */
async function readStable(deps: CommentThreadRunnerDependencies, attempts = 2): Promise<string> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try { return await dismissBlockingSheet(deps, await deps.read()); }
    catch (error) { if (error instanceof MobileJobAbortedError) throw error; lastError = error; if (attempt + 1 < attempts) await deps.wait(1_200 + attempt * 600); }
  }
  throw lastError instanceof Error ? lastError : new Error("Android no ha devuelto la estructura de la pantalla.");
}

/**
 * Menú que Facebook abre al mantener pulsada una foto («Guardar en el teléfono»,
 * «Compartir externamente», «Denunciar foto»). En móviles lentos un desplazamiento
 * puede interpretarse como pulsación larga y este menú tapa los comentarios.
 */
const BLOCKING_SHEET = /^(Guardar en el teléfono|Guardar foto|Compartir externamente|Denunciar foto|Copiar enlace a la foto|Save to phone|Save photo|Share externally|Report photo)$/i;
export function isBlockingSheet(xml: string): boolean {
  return facebookNodes(xml).filter((node) => BLOCKING_SHEET.test(nodeText(node).trim())).length >= 2;
}
async function dismissBlockingSheet(deps: CommentThreadRunnerDependencies, xml: string): Promise<string> {
  for (let attempt = 0; attempt < 2 && isBlockingSheet(xml); attempt++) {
    await deps.back();
    await deps.wait(900);
    xml = await deps.read();
  }
  return xml;
}

/** ¿Aparece ya este mismo texto publicado (fuera del campo de escribir)? */
function textAlreadyVisible(xml: string, text: string): boolean {
  const wanted = normalizeFacebookText(text);
  return facebookNodes(xml).some((node) => !COMPOSER.test(node.className) && normalizeFacebookText(node.text) === wanted);
}

function composerNode(xml: string, reply: boolean) {
  const editors = facebookNodes(xml).filter((node) => COMPOSER.test(node.className));
  return editors.find((node) => (reply ? /respon|respu|reply/i : /coment|comment|respon|reply/i).test(`${node.text} ${node.contentDescription}`))
    ?? editors[0];
}

function placeholderNode(xml: string) {
  if (facebookNodes(xml).some(node => /^(SIGUIENTE:|NEXT:)/i.test(nodeText(node)))) return undefined;
  return facebookNodes(xml).find((node) => !COMPOSER.test(node.className) && COMPOSER_PLACEHOLDER.test(nodeText(node)));
}

const isReel = (url: string) => /facebook\.com\/reels?\//i.test(url);
function protectReelNavigation(deps: CommentThreadRunnerDependencies, url: string): CommentThreadRunnerDependencies {
  if (!isReel(url)) return deps;
  return {
    ...deps,
    scroll: async (xml, direction) => {
      if (!visibleComments(xml).length && !composerNode(xml, false)) {
        throw new Error(`El panel de comentarios del reel no está abierto. Se reintentará desde el enlace original sin desplazar el vídeo. ${screenSummary(xml)}`);
      }
      await deps.scroll(xml, direction);
    }
  };
}

function commentButton(xml: string) {
  const nodes = facebookNodes(xml);
  const nextOverlay = nodes.some(node => /^(SIGUIENTE:|NEXT:)/i.test(nodeText(node)));
  return nodes.filter(node => !nextOverlay || COMMENT_ENTRY.test(nodeText(node)) || COMMENT_COUNTER.test(nodeText(node)))
    .filter((node) => COMMENT_BUTTON.test(nodeText(node)) || COMMENT_COUNTER.test(nodeText(node)))
    .sort((a, b) => Number(COMMENT_COUNTER.test(nodeText(b)) || COMMENT_ENTRY.test(nodeText(b))) - Number(COMMENT_COUNTER.test(nodeText(a)) || COMMENT_ENTRY.test(nodeText(a)))
      || Number(b.clickable) - Number(a.clickable))[0];
}

/**
 * Visor de foto (algunas versiones de Facebook abren así los anuncios con imagen):
 * la barra «Me gusta · Comentar · Compartir» no tiene etiquetas accesibles. Se
 * localiza por posición, justo debajo del texto de la publicación.
 */
export function photoViewerCommentPoint(xml: string): AndroidUiPoint | null {
  const nodes = facebookNodes(xml);
  if (!nodes.some((node) => /^(Foto|Photo)$/i.test(nodeText(node)))) return null;
  const caption = nodes.filter((node) => nodeText(node).length >= 40 && !COMPOSER.test(node.className))
    .sort((a, b) => b.bounds.bottom - a.bounds.bottom)[0];
  if (!caption) return null;
  const screenBottom = Math.max(...nodes.map((node) => node.bounds.bottom));
  const screenRight = Math.max(...nodes.map((node) => node.bounds.right));
  const row = nodes.filter((node) => node.clickable && !nodeText(node) && node.bounds.top >= caption.bounds.bottom - 5
    && node.bounds.bottom - node.bounds.top < 160 && node.bounds.right - node.bounds.left < screenRight * 0.6)
    .sort((a, b) => a.bounds.top - b.bounds.top || a.bounds.left - b.bounds.left);
  const first = row[0];
  const sameRow = first ? row.filter((node) => Math.abs(node.bounds.top - first.bounds.top) < 25).sort((a, b) => a.bounds.left - b.bounds.left) : [];
  if (sameRow.length >= 3) return sameRow[1]!.center;
  const y = Math.min(screenBottom - 20, caption.bounds.bottom + Math.round(screenBottom * 0.035));
  return { x: Math.round(screenRight * 0.27), y };
}

function commentEntry(xml: string): { center: AndroidUiPoint } | undefined {
  const button = commentButton(xml);
  if (button) return button;
  const post = visiblePostComments(xml)[0];
  if (post) return { center: post.point };
  const photo = photoViewerCommentPoint(xml);
  return photo ? { center: photo } : undefined;
}

/** Resumen de lo que hay en pantalla para que el error sea diagnosticable desde el Hub. */
function screenSummary(xml: string): string {
  const nodes = parseAndroidUiNodes(xml);
  const packages = [...new Set(nodes.map((node) => node.packageName).filter(Boolean))].slice(0, 3).join(", ");
  const short = (value: string) => value.length > 45 ? `${value.slice(0, 42)}…` : value;
  const labels = [...new Set(nodes.filter((node) => node.clickable).map((node) => short((node.text || node.contentDescription).trim())).filter(Boolean))].slice(0, 20).join(" | ");
  const texts = [...new Set(nodes.filter((node) => !node.clickable).map((node) => short((node.text || node.contentDescription).trim())).filter(Boolean))].slice(0, 12).join(" | ");
  return `App en pantalla: ${packages || "desconocida"}. Botones visibles: ${labels || "ninguno"}. Textos: ${texts || "ninguno"}`.slice(0, 900);
}

/** Deja la pantalla con el campo de escribir comentario (EditText) visible. */
async function revealComposer(deps: CommentThreadRunnerDependencies, reel = false): Promise<string> {
  let xml = await readStable(deps);
  for (let step = 0; step < 4; step++) {
    if (composerNode(xml, false)) return xml;
    const button = commentEntry(xml);
    if (button) { await deps.tap(button.center); await deps.wait(1_500); xml = await readStable(deps); continue; }
    const placeholder = placeholderNode(xml);
    if (placeholder) { await deps.tap(placeholder.center); await deps.wait(1_000); xml = await readStable(deps); continue; }
    // Swiping a reel changes the destination instead of revealing its controls.
    if (reel) await deps.wait(1_500);
    else await deps.scroll(xml, "down");
    xml = await readStable(deps);
  }
  return xml;
}

/**
 * Plan B cuando la estructura del comentario no se reconoce (otro diseño de
 * Facebook, idioma o autor sin botón): localiza el texto exacto en pantalla y
 * usa el botón «Responder» más cercano por debajo de él.
 */
const REPLY_BUTTON = /^(Responder al comentario de |Reply to .*comment|Responder$|Reply$)/i;
export function replyButtonBelowText(xml: string, wanted: string): { point: AndroidUiPoint; text: string; author: string } | null {
  const nodes = facebookNodes(xml).filter((node) => !COMPOSER.test(node.className));
  const holders = nodes.filter((node) => {
    const text = normalizeFacebookText(nodeText(node));
    return text === wanted || (wanted.length >= 20 && text.includes(wanted) && text.length <= wanted.length + 80);
  });
  const tops = [...new Set(holders.map((node) => node.bounds.top))];
  if (tops.length !== 1) return null;
  const holder = holders.sort((a, b) => (a.bounds.bottom - a.bounds.top) - (b.bounds.bottom - b.bounds.top))[0]!;
  const reply = nodes.filter((node) => REPLY_BUTTON.test(nodeText(node)) && node.bounds.top >= holder.bounds.bottom - 10 && node.bounds.top - holder.bounds.bottom < 260)
    .sort((a, b) => a.bounds.top - b.bounds.top)[0];
  return reply ? { point: reply.center, text: nodeText(holder), author: nodeText(reply).replace(/^(Responder al comentario de |Reply to )/i, "").replace(/[,.].*$/, "") } : null;
}

async function locateParent(message: CommentThreadMessage, deps: CommentThreadRunnerDependencies) {
  const wanted = normalizeFacebookText(message.replyToText ?? "");
  if (!wanted) throw new Error("La respuesta no conoce el texto del comentario original.");
  let xml = await readStable(deps);
  let openedComments = false;
  if (!visibleComments(xml).length) {
    const button = commentEntry(xml);
    if (button) { openedComments = true; await deps.tap(button.center); await deps.wait(1_500); xml = await readStable(deps); }
  }
  let previous = "";
  let sorted = false;
  let loadingReads = 0;
  let unchangedReads = 0;
  const expandedPreviews = new Set<string>();
  for (let screen = 0; screen < 24; screen++) {
    // The photo and then the comments can each finish loading after the first read.
    // Re-evaluate their controls instead of scrolling the photo for the entire search.
    const sort = !sorted && namedControl(xml, /^(Más pertinentes|Más recientes|Most relevant|Newest|Se muestran (?:Más pertinentes|Más recientes) comentarios|Showing Most relevant comments(?:[.]|$))/i);
    if (sort) {
      await deps.tap(sort.center);
      await deps.wait(800);
      const choices = await readStable(deps);
      const all = namedControl(choices, /^(Todos los comentarios|All comments)(\b|$)/i)
        ?? namedControl(choices, /^(Más recientes|Newest)(\b|$)/i);
      sorted = true;
      if (all) {
        await deps.tap(all.center);
        await deps.wait(1_200);
      } else {
        // Sin opción «Todos los comentarios»: cerrar el menú y buscar con el orden actual.
        await deps.back();
        await deps.wait(900);
      }
      xml = await readStable(deps);
    }
    const comments = visibleComments(xml);
    let matches = comments.filter((comment) => normalizeFacebookText(comment.text) === wanted);
    // Facebook puede añadir líneas al bloque (fecha, «Editado», traducción): se acepta
    // el comentario que contiene el texto completo del original.
    if (!matches.length && wanted.length >= 20) matches = comments.filter((comment) => normalizeFacebookText(comment.text).includes(wanted));
    if (matches.length > 1) throw new Error("Hay varios comentarios con el mismo texto. Comprueba el destinatario antes de responder.");
    if (matches[0]) return matches[0];
    const byText = replyButtonBelowText(xml, wanted);
    if (byText) return byText;
    const previews = collapsedReplyPreviews(xml).filter(preview => !expandedPreviews.has(preview.label));
    const preview = previews.find(item => normalizeFacebookText(item.text) === wanted) ?? previews[0];
    if (preview) {
      expandedPreviews.add(preview.label);
      await deps.tap(preview.point);
      await deps.wait(1_200);
      xml = await readStable(deps);
      continue;
    }
    const more = namedControl(xml, /^(Ver más comentarios|Ver comentarios anteriores|View more comments|View previous comments|Ver (?:\d+|una) respuestas?|Ver respuestas|View \d+ repl(?:y|ies)|View replies)/i);
    if (more) { await deps.tap(more.center); await deps.wait(1_200); xml = await readStable(deps); continue; }
    if (!openedComments && !visibleComments(xml).length && !placeholderNode(xml) && !composerNode(xml, false)) {
      const entry = commentEntry(xml);
      if (entry) {
        openedComments = true;
        await deps.tap(entry.center);
        await deps.wait(1_500);
        xml = await readStable(deps);
        continue;
      }
    }
    const signature = screenSignature(xml);
    if (!signature && loadingReads++ < 2) {
      await deps.wait(1_500);
      xml = await readStable(deps);
      continue;
    }
    if (signature === previous) {
      if (++unchangedReads >= 3) break;
      await deps.wait(1_200);
    } else unchangedReads = 0;
    previous = signature;
    await deps.scroll(xml, "down");
    xml = await readStable(deps);
  }
  throw new Error(`No se encuentra en la publicación el comentario de ${message.replyToAuthor ?? "la otra cuenta"} al que hay que responder. No se ha publicado nada. ${screenSummary(xml)}`);
}

async function openPost(url: string, deps: CommentThreadRunnerDependencies) {
  await deps.openUrl(url);
  await deps.wait(3_000);
  // Móviles con Facebook duplicado (app dual): elegir la app principal en «Abrir con».
  for (let attempt = 0; attempt < 2; attempt++) {
    const chooser = findAppChooserTarget(await readStable(deps), APP_LABELS.facebook);
    if (!chooser) break;
    await deps.tap(chooser);
    await deps.wait(3_000);
  }
}

/** Recorre los comentarios de la publicación buscando el texto exacto del mensaje. */
async function findPublished(text: string, deps: CommentThreadRunnerDependencies): Promise<boolean> {
  let xml = await readStable(deps);
  if (textAlreadyVisible(xml, text)) return true;
  if (!visibleComments(xml).length) {
    const button = commentEntry(xml);
    if (!button) return false;
    await deps.tap(button.center);
    await deps.wait(1_500);
    xml = await readStable(deps);
  }
  let previous = "";
  const expandedPreviews = new Set<string>();
  let sorted = false;
  let unchangedReads = 0;
  for (let screen = 0; screen < 24; screen++) {
    if (textAlreadyVisible(xml, text)) return true;
    const sort = !sorted && namedControl(xml, /^(Más pertinentes|Más recientes|Most relevant|Newest|Se muestran (?:Más pertinentes|Más recientes) comentarios|Showing Most relevant comments(?:[.]|$))/i);
    if (sort) {
      await deps.tap(sort.center);
      await deps.wait(800);
      const choices = await readStable(deps);
      const all = namedControl(choices, /^(Todos los comentarios|All comments)(\b|$)/i);
      if (!all) return false;
      await deps.tap(all.center);
      await deps.wait(1_200);
      xml = await readStable(deps);
      sorted = true;
      if (textAlreadyVisible(xml, text)) return true;
    }
    const preview = collapsedReplyPreviews(xml).find(item => !expandedPreviews.has(item.label));
    if (preview) {
      expandedPreviews.add(preview.label);
      await deps.tap(preview.point);
      await deps.wait(1_200);
      xml = await readStable(deps);
      continue;
    }
    const more = namedControl(xml, /^(Ver más comentarios|Ver comentarios anteriores|Ver (?:\d+|una) respuestas?|Ver respuestas|View more comments|View previous comments|View \d+ repl(y|ies))/i);
    if (more) { await deps.tap(more.center); await deps.wait(1_200); xml = await readStable(deps); continue; }
    const signature = screenSignature(xml);
    if (signature === previous) {
      if (++unchangedReads >= 3) break;
      await deps.wait(1_200);
    } else unchangedReads = 0;
    previous = signature;
    await deps.scroll(xml, "down");
    xml = await readStable(deps);
  }
  return textAlreadyVisible(xml, text);
}

/** Runs the production navigation against a real phone without editing or sending. */
export async function inspectCommentThreadNavigation(message: CommentThreadMessage, deps: CommentThreadRunnerDependencies): Promise<string> {
  deps = protectReelNavigation(deps, message.postUrl);
  const source = deps;
  const trace: string[] = [];
  const record = (event: string) => { trace.push(event); if (trace.length > 12) trace.shift(); };
  deps = {
    ...source,
    read: async () => { const xml = await source.read(); record(screenSummary(xml)); return xml; },
    tap: async (point) => { record(`Toque ${point.x},${point.y}`); await source.tap(point); },
    scroll: async (xml, direction) => { record(`Desplazamiento ${direction}`); await source.scroll(xml, direction); }
  };
  await openPost(message.postUrl, deps);
  if (message.mode === "reply") {
    const parent = await locateParent(message, deps);
    return `Destinatario localizado automáticamente: ${parent.author}. Texto: ${parent.text}. Recorrido: ${trace.join(" → ")}`;
  }
  const xml = await revealComposer(deps, isReel(message.postUrl));
  if (!composerNode(xml, false)) throw new Error(`No se ha localizado el campo de comentario. Recorrido: ${trace.join(" → ")}`);
  return `Campo de comentario localizado automáticamente. No se ha escrito ni enviado nada. Recorrido: ${trace.join(" → ")}`;
}

/**
 * Publica un único mensaje aprobado: comentario nuevo o respuesta a un comentario
 * ya publicado. Todo lo que ocurre ANTES de pulsar Enviar puede fallar y reintentarse
 * sin riesgo. Lo que ocurre DESPUÉS nunca lanza error: si no se puede confirmar,
 * se deja «en revisión» para no duplicar el comentario.
 */
export async function postCommentThreadMessage(message: CommentThreadMessage, deps: CommentThreadRunnerDependencies): Promise<CommentThreadMessage> {
  deps = protectReelNavigation(deps, message.postUrl);
  // 1) ¿Ya está publicado? (reintentos, recargas, envíos sin confirmar). Si aparece,
  //    no se vuelve a escribir.
  await openPost(message.postUrl, deps);
  if (await findPublished(message.text, deps)) {
    return { ...message, outcome: "sent", detail: "El mensaje ya estaba publicado; no se ha vuelto a escribir." };
  }
  if (message.outcome === "review" || message.outcome === "sent") {
    return { ...message, outcome: "review", detail: message.sendProtocol === "checkpoint-v1" ? "El envío anterior sigue sin confirmarse. Se volverá a comprobar automáticamente sin duplicar el comentario." : "El envío anterior sigue sin confirmarse. No se volverá a enviar automáticamente; comprueba la publicación." };
  }
  // 2) Publicar desde una pantalla limpia de la publicación.
  await openPost(message.postUrl, deps);
  let xml: string;
  if (message.mode === "reply") {
    const parent = await locateParent(message, deps);
    await deps.tap(parent.point);
    await deps.wait(1_000);
    xml = await readStable(deps);
  } else {
    xml = await revealComposer(deps, isReel(message.postUrl));
  }
  // Protección anti-duplicados: si el texto ya está publicado (p. ej. un intento
  // anterior sí se envió), no se vuelve a escribir.
  if (textAlreadyVisible(xml, message.text)) {
    return { ...message, outcome: "sent", detail: "El mensaje ya estaba publicado; no se ha vuelto a escribir." };
  }
  const composer = composerNode(xml, message.mode === "reply");
  if (!composer) throw new Error(`Facebook no ha mostrado el campo para escribir el comentario. No se ha publicado nada. ${screenSummary(xml)}`);
  await deps.tap(composer.center);
  await deps.wait(600);
  await deps.paste(message.text);
  await deps.wait(700);
  xml = await readStable(deps);
  const filledEditor = (hierarchy: string) => facebookNodes(hierarchy).find((node) => COMPOSER.test(node.className) && normalizeFacebookText(node.text) === normalizeFacebookText(message.text));
  let filled = filledEditor(xml);
  let send = namedControl(xml, SEND);
  // Facebook's reel composer can expose only its focused EditText while the
  // keyboard is open. Dismiss it once, then verify both controls afresh; never
  // infer a send target from the old screen or from fixed coordinates.
  if (filled?.focused && !send) {
    await deps.back();
    await deps.wait(700);
    xml = await readStable(deps);
    filled = filledEditor(xml);
    send = namedControl(xml, SEND);
  }
  if (!filled || !send) throw new Error(`No se ha podido verificar el texto escrito o el botón de enviar. No se ha publicado nada. ${screenSummary(xml)}`);

  // Persistir la intención ANTES del efecto externo. Un reinicio solo verificará.
  await deps.beforeSend();
  // A partir de aquí el comentario puede estar publicado: nada puede lanzar error.
  try { await deps.tap(send.center); }
  catch { return { ...message, outcome: "review", detail: message.sendProtocol === "checkpoint-v1" ? "No se pudo confirmar la pulsación de Enviar. Se comprobará automáticamente si el comentario aparece." : "No se pudo confirmar la pulsación de Enviar. Revisa la publicación y marca el mensaje como publicado si aparece." }; }
  let shown = false;
  for (let attempt = 0; attempt < 5 && !shown; attempt++) {
    try {
      await deps.wait(1_800);
      const after = await deps.read();
      shown = textAlreadyVisible(after, message.text);
    } catch { /* pantalla en movimiento: se reintenta la comprobación */ }
  }
  return shown
    ? { ...message, outcome: "sent", detail: "Mensaje visible en Facebook." }
    : { ...message, outcome: "review", detail: message.sendProtocol === "checkpoint-v1" ? "Se pulsó Enviar pero no se ha podido confirmar. Se comprobará automáticamente antes de continuar la conversación." : "Se pulsó Enviar pero no se ha podido confirmar. Revisa la publicación y pulsa «Confirmo que está publicado» para continuar la conversación." };
}
