import { parseAndroidUiNodes, type AndroidUiNode, type AndroidUiPoint } from "@/components/mobile/android-ui-hierarchy";
import { conversationFingerprint, normalizeFacebookText } from "@/lib/mobile/facebook-conversations";
import { facebookCommentDate } from "@/lib/mobile/facebook-comment-dates";

export const facebookNodes = (xml: string) => parseAndroidUiNodes(xml).filter((node) => /^com\.facebook\.(katana|lite)$/.test(node.packageName));
export const nodeText = (node: AndroidUiNode) => (node.text || node.contentDescription).trim();
export function namedControl(xml: string, pattern: RegExp) {
  return facebookNodes(xml).find((node) => pattern.test(nodeText(node)));
}
export function joinedGroupRows(xml: string) {
  const nodes = facebookNodes(xml);
  const pins = nodes.filter((node) => /^(Fijar grupo|Desfijar grupo|Pin group|Unpin group)$/i.test(nodeText(node)));
  return pins.flatMap((pin) => {
    const title = nodes.find((node) => node.className === "android.view.ViewGroup" && node.text.trim()
      && node.bounds.left > 100 && node.bounds.right < pin.bounds.right
      && node.bounds.top >= pin.bounds.top - 50 && node.bounds.top < pin.bounds.bottom
      && !/^(\d|Fijar|Desfijar)/.test(node.text));
    const details = title ? nodes.find((node) => node.bounds.left === title.bounds.left && node.bounds.top >= title.bounds.bottom && node.bounds.top < pin.bounds.bottom + 40 && /miembros|members/i.test(nodeText(node))) : null;
    return title ? [{ name: nodeText(title), details: details ? nodeText(details) : "", point: title.center }] : [];
  });
}

export type NativeComment = { id: string; author: string; text: string; sourceLabel: string; point: AndroidUiPoint; dateLabel?: string };
export function visibleComments(xml: string): NativeComment[] {
  const nodes = facebookNodes(xml);
  const replyButtons = nodes.filter((node) => /^(Responder al comentario de |Reply to .*comment)/i.test(nodeText(node)));
  const profiles = nodes.filter((node) => /^(Foto de perfil de |Profile picture of )/.test(node.contentDescription)).sort((a, b) => a.bounds.top - b.bounds.top);
  return replyButtons.flatMap((reply) => {
    const profile = profiles.filter((node) => node.bounds.top < reply.bounds.top).at(-1);
    if (!profile) return [];
    const authorNode = nodes.find((node) => node.text && node.className === "android.widget.Button"
      && node.bounds.left >= profile.bounds.right && Math.abs(node.bounds.top - profile.bounds.top) < 45
      && node.bounds.bottom < reply.bounds.top);
    if (!authorNode) return [];
    const author = nodeText(authorNode);
    const dateNode = nodes.find((node) => node.bounds.left >= authorNode.bounds.right - 15
      && Math.abs(node.bounds.top - authorNode.bounds.top) < 45 && node.bounds.bottom < reply.bounds.top
      && facebookCommentDate(nodeText(node), Date.now()) !== null);
    const lines = [...new Set(nodes.filter((node) => node.bounds.top >= authorNode.bounds.bottom
      && node.bounds.bottom <= reply.bounds.top && node.bounds.left >= profile.bounds.right
      && !/ImageView|EditText|AutoCompleteTextView/.test(node.className))
      .map(nodeText).filter((text) => text && !/^(Autor|Author|GIPHY|El GIF |GIF |Ver traducción|See translation|\d+\s*(min|h|d|sem|s|m)|[·\s]+$)/i.test(text)))];
    const text = lines.join("\n").slice(0, 3000);
    if (!text) return [];
    return [{ id: conversationFingerprint([author, text]), author, text, dateLabel: dateNode ? nodeText(dateNode) : "", sourceLabel: nodeText(reply), point: reply.center }];
  });
}

export type NativePost = { anchor: string; point: AndroidUiPoint };
export function visiblePostComments(xml: string): NativePost[] {
  const nodes = facebookNodes(xml);
  // The generic "Comentar" button is present even on empty posts. Only a
  // positive explicit counter is evidence that a thread is worth opening.
  const buttons = nodes.filter((node) => /^(?:Ver (?:los )?)?[1-9]\d*[\d., mil]* comentarios?(?:[.,].*)?$/i.test(nodeText(node))
    && (node.clickable || node.className === "android.widget.Button"));
  return buttons.flatMap((button) => {
    const previous = nodes.filter((node) => node.bounds.bottom <= button.bounds.top && node.bounds.top > 210
      && nodeText(node).length >= 20 && !/^(Foto de|Ver |Toca |Compartir|Me gusta|Unirte|Reaccionar)/i.test(nodeText(node))
      && !/ImageView/.test(node.className)).sort((a, b) => b.bounds.bottom - a.bounds.bottom);
    const anchor = previous.slice(0, 3).map(nodeText).join(" | ").slice(0, 3000);
    return anchor ? [{ anchor, point: button.center }] : [];
  });
}

export function findExactComment(xml: string, author: string, text: string) {
  const matches = visibleComments(xml).filter((item) => normalizeFacebookText(item.author) === normalizeFacebookText(author)
    && normalizeFacebookText(item.text) === normalizeFacebookText(text));
  return matches.length === 1 ? matches[0] : null;
}

export function screenSignature(xml: string) {
  return facebookNodes(xml).map(nodeText).filter(Boolean).join("|");
}
