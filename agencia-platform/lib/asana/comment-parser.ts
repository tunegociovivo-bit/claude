/**
 * Convierte un comentario (story) de Asana a un doc TipTap rico para
 * el Hub. La conversión PRESERVA las imágenes inline: detecta los
 * `asset_id` que Asana embebe como URLs
 * `https://app.asana.com/app/asana/-/get_asset?asset_id=NUM`, descarga
 * el binario, lo sube a R2/S3 y lo inserta como nodo `image` en el
 * doc. Así los comentarios quedan visualmente fieles a Asana incluso
 * cuando éste se apague.
 *
 * El parser es deliberadamente simple — opera sobre html_text de
 * Asana sin un DOMParser real (no disponible en Node sin polyfill).
 * Maneja los casos comunes:
 *   - <body>…</body> envolvente: se quita.
 *   - <a href="…get_asset?asset_id=N">nombre</a> → nodo image inline
 *   - <a data-asana-gid="N">nombre</a> sin asset → texto plano del label
 *   - <br>, <p>: separadores de línea
 *   - Texto suelto fuera de tags: texto plano
 *
 * Si tenemos download_url (que Asana sirve temporalmente al pedir
 * /attachments/{gid}) bajamos el binario. Si la subida falla o el
 * storage no está configurado, dejamos un párrafo con el nombre del
 * archivo entre paréntesis ("[imagen: foto.png — adjunto perdido]")
 * para que el user sepa que faltaba algo.
 */

import { AsanaClient } from "./client";
import { buildS3Key, isStorageEnabled, signedDownloadUrl, uploadBuffer } from "@/lib/storage/r2";

type ParseResult = {
  doc: any;
  assetsImported: number;
  assetsFailed: number;
};

const ASSET_ID_RE = /asset_id=(\d+)/;
const ASSET_HREF_RE = /https?:\/\/app\.asana\.com\/[^"'<>\s]*asset_id=\d+[^"'<>\s]*/g;

export async function parseAsanaCommentToTipTap(opts: {
  client: AsanaClient;
  workspaceId: string;
  taskLocalId: string;
  story: { gid: string; text?: string; html_text?: string };
}): Promise<ParseResult> {
  const result: ParseResult = { doc: emptyDoc(), assetsImported: 0, assetsFailed: 0 };

  // 1) Recolectar todos los GIDs de attachment mencionados. Asana
  // los embebe de DOS formas distintas:
  //   a) URLs en el texto plain o links http:
  //      https://app.asana.com/app/asana/-/get_asset?asset_id=1205…
  //   b) Tags <a> en el html_text con `data-asana-gid="1205…"`,
  //      típicamente con data-asana-type="attachment" y href vacío.
  //      ESTE es el caso de las imágenes pegadas en el comentario —
  //      sin href, así que el regex de URL no las pillaba antes.
  const html = opts.story.html_text ?? "";
  const text = opts.story.text ?? "";
  const assetIds = new Set<string>();
  // 1.a) asset_id=N en URLs (text o html con href).
  for (const src of [html, text]) {
    for (const m of src.matchAll(/asset_id=(\d+)/g)) assetIds.add(m[1]);
  }
  // 1.b) <a data-asana-gid="N"> CON type="attachment" — el formato
  // que Asana usa para imágenes pegadas en el cuerpo del comentario.
  // OJO: `data-asana-gid` también se usa para MENCIONES de usuario
  // (<a data-asana-gid="USERID">@Nombre</a>), así que filtramos por
  // data-asana-type="attachment" para no intentar descargar
  // attachments de IDs de usuario.
  for (const m of html.matchAll(
    /<a\s+[^>]*?data-asana-gid="(\d+)"[^>]*?data-asana-type="attachment"[^>]*>/gi
  )) {
    assetIds.add(m[1]);
  }
  // Y la variante con los atributos en orden inverso (Asana no
  // garantiza orden).
  for (const m of html.matchAll(
    /<a\s+[^>]*?data-asana-type="attachment"[^>]*?data-asana-gid="(\d+)"[^>]*>/gi
  )) {
    assetIds.add(m[1]);
  }

  // 2) Descargar cada asset (en paralelo) y mapear assetId → URL final.
  const assetUrls = new Map<string, { url: string; alt: string } | null>();
  await Promise.all(
    Array.from(assetIds).map(async (id) => {
      try {
        const det = await opts.client.attachmentDetails(id);
        const downloadUrl = det.data.download_url;
        const name = det.data.name ?? `asana-${id}`;
        if (!downloadUrl) {
          assetUrls.set(id, null);
          return;
        }
        if (!isStorageEnabled()) {
          // Sin storage propio, dejamos al menos el download_url de
          // Asana — temporal pero al menos vivos durante la migración.
          assetUrls.set(id, { url: downloadUrl, alt: name });
          return;
        }
        const r = await fetch(downloadUrl);
        if (!r.ok) {
          assetUrls.set(id, null);
          return;
        }
        const contentType = r.headers.get("content-type") ?? "application/octet-stream";
        const buf = Buffer.from(await r.arrayBuffer());
        const s3Key = buildS3Key({
          workspaceId: opts.workspaceId,
          targetType: "COMMENT",
          targetId: opts.taskLocalId,
          filename: name
        });
        await uploadBuffer({ s3Key, body: buf, contentType });
        const publicUrl = await signedDownloadUrl(s3Key);
        assetUrls.set(id, { url: publicUrl, alt: name });
        result.assetsImported++;
      } catch {
        result.assetsFailed++;
        assetUrls.set(id, null);
      }
    })
  );

  // 3) Construir el doc TipTap.
  // Preferimos html_text porque tiene markup; si no hay, caemos a text.
  result.doc = html ? htmlToTipTap(html, assetUrls) : textToTipTap(text, assetUrls);
  return result;
}

function emptyDoc(): any {
  return { type: "doc", content: [{ type: "paragraph" }] };
}

/**
 * Convierte el html_text de Asana en un doc TipTap. Es un parser
 * pragmático: no necesitamos perfección semántica, solo preservar
 * texto + imágenes inline.
 */
function htmlToTipTap(html: string, assets: Map<string, { url: string; alt: string } | null>): any {
  // Quitar wrapper <body>…</body> si lo hay.
  let h = html.trim();
  if (h.startsWith("<body>")) h = h.slice(6);
  if (h.endsWith("</body>")) h = h.slice(0, -7);

  // Convertimos <br>, </p>, etc., en marcadores de salto antes de
  // limpiar el resto del HTML. Así preservamos los párrafos.
  h = h
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<p[^>]*>/gi, "")
    .replace(/<\/div>/gi, "\n")
    .replace(/<div[^>]*>/gi, "");

  // Recorremos buscando <a ...>...</a>; cada match es un nodo aparte
  // (imagen si tiene asset_id en href, texto plano si no). Lo demás
  // es texto suelto.
  const content: any[] = [];
  let currentParagraph: any[] = [];

  function flushParagraph() {
    if (currentParagraph.length === 0) return;
    content.push({ type: "paragraph", content: currentParagraph });
    currentParagraph = [];
  }

  function pushText(raw: string) {
    // Decodifica entidades básicas y normaliza saltos.
    const decoded = decodeEntities(stripTags(raw));
    if (!decoded) return;
    const parts = decoded.split(/\n+/);
    parts.forEach((p, i) => {
      if (p.trim()) currentParagraph.push({ type: "text", text: p });
      if (i < parts.length - 1) flushParagraph();
    });
  }

  // Capturamos cualquier <a ...>...</a> con TODOS sus atributos.
  // Decidimos qué es según: data-asana-type="attachment" + data-asana-gid
  // → imagen embebida; href con asset_id=N → también imagen; href http
  // → link normal; otros (data-asana-gid sin type=attachment) → mención.
  const tagRe = /<a\s+([^>]*?)>([\s\S]*?)<\/a>/gi;
  let last = 0;
  for (const m of h.matchAll(tagRe)) {
    const start = m.index ?? 0;
    if (start > last) pushText(h.slice(last, start));
    const attrs = m[1];
    const inner = stripTags(m[2]);
    const hrefMatch = attrs.match(/href="([^"]*)"/);
    const href = hrefMatch?.[1] ?? "";
    const dataGidMatch = attrs.match(/data-asana-gid="(\d+)"/);
    const dataType = attrs.match(/data-asana-type="([^"]+)"/)?.[1];
    const assetMatch = href.match(ASSET_ID_RE);

    // Es un attachment si: tiene data-asana-type="attachment" Y
    // data-asana-gid, O bien el href contiene asset_id=N.
    const attachmentId =
      (dataType === "attachment" && dataGidMatch ? dataGidMatch[1] : null) ??
      assetMatch?.[1] ??
      null;

    if (attachmentId) {
      const asset = assets.get(attachmentId);
      if (asset) {
        flushParagraph();
        content.push({ type: "image", attrs: { src: asset.url, alt: asset.alt } });
      } else {
        currentParagraph.push({
          type: "text",
          text: `[imagen perdida: ${inner || attachmentId}]`
        });
      }
    } else if (href.startsWith("http")) {
      // Link normal: texto con mark link.
      currentParagraph.push({
        type: "text",
        text: inner || href,
        marks: [{ type: "link", attrs: { href, target: "_blank" } }]
      });
    } else {
      // Mención de Asana u otro <a> sin asset_id ni href http
      // (data-asana-gid). Mantenemos el texto del label como
      // mention plano.
      if (inner) currentParagraph.push({ type: "text", text: `@${inner}` });
    }
    last = start + m[0].length;
  }
  if (last < h.length) pushText(h.slice(last));
  flushParagraph();

  if (content.length === 0) return emptyDoc();
  return { type: "doc", content };
}

function textToTipTap(text: string, assets: Map<string, { url: string; alt: string } | null>): any {
  if (!text) return emptyDoc();

  // Sustituimos URLs de get_asset por nodos image. Como aquí trabajamos
  // con texto plano (no HTML), partimos el texto en segmentos por
  // las URLs.
  const content: any[] = [];
  let cursor = 0;
  let currentParagraph: any[] = [];
  function flushParagraph() {
    if (currentParagraph.length === 0) return;
    content.push({ type: "paragraph", content: currentParagraph });
    currentParagraph = [];
  }
  function pushTextChunk(s: string) {
    if (!s) return;
    const parts = s.split(/\n+/);
    parts.forEach((p, i) => {
      if (p.trim()) currentParagraph.push({ type: "text", text: p });
      if (i < parts.length - 1) flushParagraph();
    });
  }

  for (const m of text.matchAll(ASSET_HREF_RE)) {
    const start = m.index ?? 0;
    if (start > cursor) pushTextChunk(text.slice(cursor, start));
    const href = m[0];
    const idMatch = href.match(ASSET_ID_RE);
    if (idMatch) {
      const asset = assets.get(idMatch[1]);
      if (asset) {
        flushParagraph();
        content.push({ type: "image", attrs: { src: asset.url, alt: asset.alt } });
      } else {
        currentParagraph.push({ type: "text", text: `[imagen perdida]` });
      }
    }
    cursor = start + href.length;
  }
  if (cursor < text.length) pushTextChunk(text.slice(cursor));
  flushParagraph();

  if (content.length === 0) return emptyDoc();
  return { type: "doc", content };
}

function stripTags(s: string): string {
  return s.replace(/<[^>]*>/g, "");
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}
