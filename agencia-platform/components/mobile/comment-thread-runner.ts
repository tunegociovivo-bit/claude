import type { AndroidUiPoint } from "@/components/mobile/android-ui-hierarchy";
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
const COMMENT_BUTTON = /^(Comentar|Comment|Escribe un comentario.*|Write a comment.*)$/i;

function snippet(text: string): string {
  return normalizeFacebookText(text).slice(0, 60);
}

function composerNode(xml: string, reply: boolean) {
  return facebookNodes(xml).find((node) => COMPOSER.test(node.className)
    && (reply ? /respon|respu|reply/i : /coment|comment|respon|reply/i).test(`${node.text} ${node.contentDescription}`))
    ?? facebookNodes(xml).find((node) => COMPOSER.test(node.className));
}

async function openCommentsIfNeeded(xml: string, deps: CommentThreadRunnerDependencies): Promise<string> {
  if (visibleComments(xml).length || composerNode(xml, false)) return xml;
  const counter = visiblePostComments(xml)[0];
  const target = counter?.point ?? namedControl(xml, COMMENT_BUTTON)?.center;
  if (!target) return xml;
  await deps.tap(target);
  await deps.wait(1_500);
  return deps.read();
}

async function locateParent(message: CommentThreadMessage, deps: CommentThreadRunnerDependencies) {
  const wanted = snippet(message.replyToText ?? "");
  if (!wanted) throw new Error("La respuesta no conoce el texto del comentario original.");
  let xml = await openCommentsIfNeeded(await deps.read(), deps);
  let previous = "";
  for (let screen = 0; screen < 12; screen++) {
    const match = visibleComments(xml).find((comment) => snippet(comment.text).startsWith(wanted.slice(0, 40))
      || normalizeFacebookText(comment.text).includes(wanted.slice(0, 40)));
    if (match) return match;
    const more = namedControl(xml, /^(Ver más comentarios|Ver comentarios anteriores|View more comments|View previous comments)$/i);
    if (more) { await deps.tap(more.center); await deps.wait(1_200); xml = await deps.read(); continue; }
    const signature = screenSignature(xml);
    if (signature === previous) break;
    previous = signature;
    await deps.scroll(xml, "down");
    xml = await deps.read();
  }
  throw new Error(`No se encuentra en la publicación el comentario de ${message.replyToAuthor ?? "la otra cuenta"} al que hay que responder. No se ha publicado nada.`);
}

/**
 * Publica un único mensaje aprobado: comentario nuevo o respuesta a un comentario
 * ya publicado. Nunca reintenta un envío ya pulsado sin confirmación: lo deja en revisión.
 */
export async function postCommentThreadMessage(message: CommentThreadMessage, deps: CommentThreadRunnerDependencies): Promise<CommentThreadMessage> {
  await deps.openUrl(message.postUrl);
  await deps.wait(2_500);
  let xml: string;
  if (message.mode === "reply") {
    const parent = await locateParent(message, deps);
    await deps.tap(parent.point);
    await deps.wait(900);
    xml = await deps.read();
  } else {
    xml = await openCommentsIfNeeded(await deps.read(), deps);
  }
  const composer = composerNode(xml, message.mode === "reply");
  if (!composer) throw new Error("Facebook no ha mostrado el campo para escribir el comentario. No se ha publicado nada.");
  await deps.tap(composer.center);
  await deps.wait(500);
  await deps.paste(message.text);
  await deps.wait(500);
  xml = await deps.read();
  const filled = facebookNodes(xml).some((node) => COMPOSER.test(node.className) && normalizeFacebookText(node.text).includes(snippet(message.text).slice(0, 30)));
  const send = namedControl(xml, SEND);
  if (!filled || !send) throw new Error("No se ha podido verificar el texto escrito o el botón de enviar. No se ha publicado nada.");
  await deps.tap(send.center);
  await deps.wait(2_000);
  xml = await deps.read();
  const shown = facebookNodes(xml).some((node) => !COMPOSER.test(node.className) && normalizeFacebookText(nodeText(node)).includes(snippet(message.text).slice(0, 30)));
  return shown
    ? { ...message, outcome: "sent", detail: "Mensaje visible en Facebook." }
    : { ...message, outcome: "review", detail: "Se pulsó Enviar pero no se ha podido confirmar. Revisa la publicación y marca el mensaje como publicado para continuar la conversación." };
}
