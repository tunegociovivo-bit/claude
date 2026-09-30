/**
 * Render de cuerpos TipTap (ProseMirror doc) para canales FUERA del Hub:
 * email (HTML con estilos inline) y WhatsApp / text/plain.
 *
 * Antes, las notificaciones de @mención metían el JSON serializado del
 * comentario tal cual en el correo — el trabajador recibía código. Aquí se
 * convierte el doc a algo legible respetando párrafos, saltos de línea,
 * negritas, enlaces, listas y menciones.
 *
 * Acepta cualquier formato que conviva en la BD (doc Json, JSON stringified
 * o texto plano legacy de Asana) vía `toTipTapDoc`.
 */

import { toTipTapDoc } from "@/lib/comments/body";

export type RichTextRenderOptions = {
  /** Máximo de caracteres de texto visible. Lo que exceda se corta con "…". */
  maxChars?: number;
  /** userId del destinatario: su @mención se resalta en el email. */
  highlightUserId?: string | null;
};

export type RichTextRenderResult = {
  output: string;
  truncated: boolean;
};

type Ctx = {
  remaining: number;
  truncated: boolean;
  highlightUserId: string | null;
};

const DEFAULT_MAX_CHARS = 1200;

// ── Estilos inline (los clientes de correo ignoran <style>) ──────────
const S = {
  p: "margin:0 0 10px 0;",
  h1: "margin:14px 0 8px 0;font-size:18px;line-height:1.35;font-weight:700;color:#111827;",
  h2: "margin:12px 0 8px 0;font-size:16px;line-height:1.35;font-weight:700;color:#111827;",
  h3: "margin:10px 0 6px 0;font-size:15px;line-height:1.35;font-weight:700;color:#111827;",
  ul: "margin:0 0 10px 0;padding:0 0 0 22px;",
  ol: "margin:0 0 10px 0;padding:0 0 0 22px;",
  li: "margin:0 0 4px 0;",
  taskUl: "margin:0 0 10px 0;padding:0;list-style:none;",
  blockquote: "margin:0 0 10px 0;padding:2px 0 2px 12px;border-left:3px solid #d1d5db;color:#4b5563;",
  pre: "margin:0 0 10px 0;padding:10px 12px;background:#111827;color:#f9fafb;border-radius:6px;font-family:Menlo,Consolas,monospace;font-size:12px;line-height:1.5;white-space:pre-wrap;word-break:break-word;",
  code: "padding:1px 5px;background:#f3f4f6;border-radius:4px;font-family:Menlo,Consolas,monospace;font-size:12px;color:#be185d;",
  hr: "border:0;border-top:1px solid #e5e7eb;margin:12px 0;",
  a: "color:#3f47d8;text-decoration:underline;word-break:break-all;",
  mention: "display:inline-block;margin:1px 0;padding:0 6px;border-radius:4px;background:#eaeefe;color:#3439b3;font-weight:600;white-space:nowrap;",
  mentionMe: "display:inline-block;margin:1px 0;padding:0 6px;border-radius:4px;background:#3f47d8;color:#ffffff;font-weight:600;white-space:nowrap;",
  image: "display:inline-block;padding:4px 10px;border:1px dashed #cbd5e1;border-radius:6px;color:#6b7280;font-size:13px;",
  ellipsis: "color:#6b7280;"
} as const;

// ═════════════════════════════════════════════════════════════════════
// HTML (email)
// ═════════════════════════════════════════════════════════════════════

export function richTextToEmailHtml(body: unknown, opts: RichTextRenderOptions = {}): RichTextRenderResult {
  const doc = trimDoc(toTipTapDoc(body));
  const ctx: Ctx = {
    remaining: opts.maxChars ?? DEFAULT_MAX_CHARS,
    truncated: false,
    highlightUserId: opts.highlightUserId ?? null
  };
  const output = renderHtmlChildren(doc.content, ctx);
  return { output, truncated: ctx.truncated };
}

function renderHtmlChildren(nodes: any, ctx: Ctx): string {
  if (!Array.isArray(nodes)) return "";
  let out = "";
  for (const n of nodes) {
    if (ctx.truncated) break;
    out += renderHtmlNode(n, ctx);
  }
  return out;
}

function renderHtmlNode(node: any, ctx: Ctx): string {
  if (!node || typeof node !== "object") return "";
  switch (node.type) {
    case "text":
      return renderHtmlText(node, ctx);
    case "hardBreak":
      return "<br>";
    case "mention":
      return renderHtmlMention(node, ctx);
    case "paragraph": {
      const inner = renderHtmlChildren(node.content, ctx);
      // Párrafo vacío = línea en blanco intencionada del usuario.
      return `<p style="${S.p}">${inner || "&nbsp;"}</p>`;
    }
    case "heading": {
      const level = clampHeading(node.attrs?.level);
      const style = level === 1 ? S.h1 : level === 2 ? S.h2 : S.h3;
      return `<p style="${style}">${renderHtmlChildren(node.content, ctx)}</p>`;
    }
    case "bulletList":
      return `<ul style="${S.ul}">${renderHtmlChildren(node.content, ctx)}</ul>`;
    case "orderedList": {
      const start = Number(node.attrs?.start);
      const startAttr = Number.isFinite(start) && start > 1 ? ` start="${Math.floor(start)}"` : "";
      return `<ol style="${S.ol}"${startAttr}>${renderHtmlChildren(node.content, ctx)}</ol>`;
    }
    case "listItem":
      return `<li style="${S.li}">${stripOuterParagraphMargin(renderHtmlChildren(node.content, ctx))}</li>`;
    case "taskList":
      return `<ul style="${S.taskUl}">${renderHtmlChildren(node.content, ctx)}</ul>`;
    case "taskItem": {
      const box = node.attrs?.checked ? "☑" : "☐";
      return `<li style="${S.li}">${box}&nbsp;${stripOuterParagraphMargin(renderHtmlChildren(node.content, ctx))}</li>`;
    }
    case "blockquote":
      return `<div style="${S.blockquote}">${renderHtmlChildren(node.content, ctx)}</div>`;
    case "codeBlock": {
      const code = consumeText(collectText(node), ctx);
      return `<pre style="${S.pre}">${escapeHtml(code)}</pre>`;
    }
    case "horizontalRule":
      return `<hr style="${S.hr}">`;
    case "image":
      // Las imágenes del Hub requieren sesión: en el correo no cargarían.
      // Mostramos un aviso en su lugar.
      return `<p style="${S.p}"><span style="${S.image}">🖼️ Imagen adjunta — ábrela en el Hub</span></p>`;
    default:
      // Nodo desconocido (extensión nueva): renderizamos sus hijos.
      return renderHtmlChildren(node.content, ctx);
  }
}

function renderHtmlText(node: any, ctx: Ctx): string {
  const raw = typeof node.text === "string" ? node.text : "";
  if (!raw) return "";
  const text = consumeText(raw, ctx);
  let html = escapeHtml(text);
  if (ctx.truncated) html += `<span style="${S.ellipsis}">…</span>`;

  const marks: any[] = Array.isArray(node.marks) ? node.marks : [];
  // `code` va lo más dentro posible; `link` lo más fuera.
  const order = ["code", "bold", "italic", "underline", "strike", "highlight", "link"];
  const sorted = [...marks].sort((a, b) => order.indexOf(a?.type) - order.indexOf(b?.type));
  for (const m of sorted) {
    switch (m?.type) {
      case "code":
        html = `<code style="${S.code}">${html}</code>`;
        break;
      case "bold":
        html = `<strong>${html}</strong>`;
        break;
      case "italic":
        html = `<em>${html}</em>`;
        break;
      case "underline":
        html = `<u>${html}</u>`;
        break;
      case "strike":
        html = `<s>${html}</s>`;
        break;
      case "highlight":
        html = `<span style="background:#fef08a;">${html}</span>`;
        break;
      case "link": {
        const href = safeHref(m.attrs?.href);
        if (href) {
          html = `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer" style="${S.a}">${html}</a>`;
        }
        break;
      }
    }
  }
  return html;
}

function renderHtmlMention(node: any, ctx: Ctx): string {
  const label = mentionLabel(node);
  const text = consumeText(`@${label}`, ctx);
  const isMe = !!ctx.highlightUserId && String(node.attrs?.id ?? "") === ctx.highlightUserId;
  return `<span style="${isMe ? S.mentionMe : S.mention}">${escapeHtml(text)}</span>`;
}

// ═════════════════════════════════════════════════════════════════════
// Texto plano / WhatsApp
// ═════════════════════════════════════════════════════════════════════

export function richTextToPlainText(
  body: unknown,
  opts: RichTextRenderOptions & { format?: "plain" | "whatsapp" } = {}
): RichTextRenderResult {
  const doc = trimDoc(toTipTapDoc(body));
  const ctx: Ctx = {
    remaining: opts.maxChars ?? DEFAULT_MAX_CHARS,
    truncated: false,
    highlightUserId: opts.highlightUserId ?? null
  };
  const wa = opts.format === "whatsapp";
  // Una línea en blanco entre bloques de primer nivel (párrafos, listas…);
  // dentro de un bloque, saltos simples.
  const blocks: string[] = [];
  for (const node of doc.content) {
    if (ctx.truncated) break;
    const lines = renderPlainBlocks([node], ctx, wa, "");
    blocks.push(lines.join("\n"));
  }
  const output = blocks
    .join("\n\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { output: ctx.truncated ? `${output}…` : output, truncated: ctx.truncated };
}

/** Devuelve una línea (o bloque multilínea) por nodo de bloque. */
function renderPlainBlocks(nodes: any, ctx: Ctx, wa: boolean, indent: string): string[] {
  if (!Array.isArray(nodes)) return [];
  const out: string[] = [];
  for (const n of nodes) {
    if (ctx.truncated) break;
    if (!n || typeof n !== "object") continue;
    switch (n.type) {
      case "paragraph":
        out.push(indent + renderPlainInline(n.content, ctx, wa));
        break;
      case "heading": {
        const t = renderPlainInline(n.content, ctx, wa);
        out.push(indent + (wa && t ? `*${t}*` : t));
        break;
      }
      case "bulletList":
      case "orderedList":
      case "taskList": {
        const startRaw = Number(n.attrs?.start);
        let i = Number.isFinite(startRaw) && startRaw > 0 ? Math.floor(startRaw) : 1;
        for (const item of Array.isArray(n.content) ? n.content : []) {
          if (ctx.truncated) break;
          const bullet =
            n.type === "orderedList" ? `${i++}. ` : n.type === "taskList" ? (item?.attrs?.checked ? "☑ " : "☐ ") : "• ";
          const inner = renderPlainBlocks(item?.content, ctx, wa, "");
          const [first = "", ...rest] = inner.filter((l) => l !== "");
          out.push(indent + bullet + first);
          for (const l of rest) out.push(indent + "   " + l);
        }
        break;
      }
      case "blockquote":
        for (const l of renderPlainBlocks(n.content, ctx, wa, "")) out.push(`${indent}> ${l}`);
        break;
      case "codeBlock": {
        const code = consumeText(collectText(n), ctx);
        out.push(wa ? "```" + code + "```" : code);
        break;
      }
      case "horizontalRule":
        out.push(indent + "———");
        break;
      case "image":
        out.push(indent + "[Imagen adjunta]");
        break;
      default:
        if (Array.isArray(n.content) && n.content.some((c: any) => c?.type === "text" || c?.type === "mention")) {
          out.push(indent + renderPlainInline(n.content, ctx, wa));
        } else {
          out.push(...renderPlainBlocks(n.content, ctx, wa, indent));
        }
    }
  }
  return out;
}

function renderPlainInline(nodes: any, ctx: Ctx, wa: boolean): string {
  if (!Array.isArray(nodes)) return "";
  let out = "";
  for (const n of nodes) {
    if (ctx.truncated) break;
    if (!n || typeof n !== "object") continue;
    if (n.type === "hardBreak") {
      out += "\n";
    } else if (n.type === "mention") {
      out += consumeText(`@${mentionLabel(n)}`, ctx);
    } else if (n.type === "text" && typeof n.text === "string") {
      let t = consumeText(n.text, ctx);
      const marks: any[] = Array.isArray(n.marks) ? n.marks : [];
      const has = (type: string) => marks.some((m) => m?.type === type);
      const link = marks.find((m) => m?.type === "link");
      const href = link ? safeHref(link.attrs?.href) : null;
      if (href && normalizeUrl(href) !== normalizeUrl(n.text)) t = `${t} (${href})`;
      if (wa && t.trim()) {
        if (has("code")) t = "`" + t + "`";
        if (has("bold")) t = wrapKeepingSpaces(t, "*");
        if (has("italic")) t = wrapKeepingSpaces(t, "_");
        if (has("strike")) t = wrapKeepingSpaces(t, "~");
      }
      out += t;
    } else if (Array.isArray(n.content)) {
      out += renderPlainInline(n.content, ctx, wa);
    }
  }
  return out;
}

// ═════════════════════════════════════════════════════════════════════
// Selección del fragmento relevante
// ═════════════════════════════════════════════════════════════════════

/**
 * Para tareas y documentos (que pueden ser largos) no tiene sentido mandar
 * el principio del texto: se extraen los bloques de primer nivel donde se
 * menciona al destinatario. Si no aparece en ninguno (p.ej. la mención
 * está en el título), se devuelve el doc completo y ya lo cortará maxChars.
 */
export function focusOnMention(body: unknown, userId: string): any {
  const doc = toTipTapDoc(body);
  const blocks: any[] = Array.isArray(doc.content) ? doc.content : [];
  const hits = blocks.filter((b) => containsMentionOf(b, userId));
  if (hits.length === 0) return doc;
  return { type: "doc", content: hits };
}

/** ¿El cuerpo tiene algo de texto visible? Evita cajas de cita vacías. */
export function hasVisibleContent(body: unknown): boolean {
  const doc = toTipTapDoc(body);
  let found = false;
  const visit = (n: any) => {
    if (found || !n || typeof n !== "object") return;
    if (n.type === "text" && typeof n.text === "string" && n.text.trim()) found = true;
    else if (n.type === "mention" || n.type === "image") found = true;
    else if (Array.isArray(n.content)) n.content.forEach(visit);
  };
  visit(doc);
  return found;
}

function containsMentionOf(node: any, userId: string): boolean {
  if (!node || typeof node !== "object") return false;
  if (node.type === "mention" && String(node.attrs?.id ?? "") === userId) return true;
  return Array.isArray(node.content) && node.content.some((c: any) => containsMentionOf(c, userId));
}

// ═════════════════════════════════════════════════════════════════════
// Utilidades
// ═════════════════════════════════════════════════════════════════════

/** Quita párrafos vacíos al principio y al final (TipTap suele dejar uno). */
function trimDoc(doc: any): { type: "doc"; content: any[] } {
  const content: any[] = Array.isArray(doc?.content) ? [...doc.content] : [];
  const isEmptyP = (n: any) =>
    n?.type === "paragraph" &&
    (!Array.isArray(n.content) ||
      n.content.every((c: any) => c?.type === "hardBreak" || (c?.type === "text" && !String(c.text ?? "").trim())));
  while (content.length && isEmptyP(content[0])) content.shift();
  while (content.length && isEmptyP(content[content.length - 1])) content.pop();
  return { type: "doc", content };
}

function consumeText(text: string, ctx: Ctx): string {
  if (ctx.truncated) return "";
  if (text.length <= ctx.remaining) {
    ctx.remaining -= text.length;
    return text;
  }
  // Cortamos en el último espacio si queda cerca, para no partir palabras.
  let cut = text.slice(0, Math.max(0, ctx.remaining));
  const lastSpace = cut.lastIndexOf(" ");
  if (lastSpace > cut.length - 20 && lastSpace > 0) cut = cut.slice(0, lastSpace);
  ctx.remaining = 0;
  ctx.truncated = true;
  return cut.trimEnd();
}

function collectText(node: any): string {
  if (!node || typeof node !== "object") return "";
  if (node.type === "text") return typeof node.text === "string" ? node.text : "";
  if (node.type === "hardBreak") return "\n";
  return Array.isArray(node.content) ? node.content.map(collectText).join("") : "";
}

function mentionLabel(node: any): string {
  const label = node?.attrs?.label ?? node?.attrs?.id ?? "";
  return String(label).replace(/^@/, "") || "usuario";
}

function clampHeading(level: unknown): 1 | 2 | 3 {
  const n = Number(level);
  if (n <= 1) return 1;
  if (n === 2) return 2;
  return 3;
}

/** Quita el margen del <p> cuando es el único hijo de un <li>. */
function stripOuterParagraphMargin(html: string): string {
  return html.replace(new RegExp(`<p style="${escapeRegExp(S.p)}">`, "g"), '<p style="margin:0;">');
}

function safeHref(href: unknown): string | null {
  if (typeof href !== "string") return null;
  const v = href.trim();
  if (/^(https?:|mailto:|tel:)/i.test(v)) return v;
  return null;
}

function normalizeUrl(s: string): string {
  return s.trim().replace(/^https?:\/\//i, "").replace(/\/+$/, "").toLowerCase();
}

/** WhatsApp no aplica formato si el marcador toca un espacio. */
function wrapKeepingSpaces(text: string, marker: string): string {
  const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(text);
  if (!m || !m[2]) return text;
  return `${m[1]}${marker}${m[2]}${marker}${m[3]}`;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
