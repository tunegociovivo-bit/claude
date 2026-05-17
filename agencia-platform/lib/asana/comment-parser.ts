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

/**
 * Reconoce URLs de plataformas de vídeo que admitan embed-iframe y
 * devuelve la URL de embed lista para meter en un <iframe>. Si la
 * URL no es de un proveedor reconocido, devuelve null.
 *
 * Soportados:
 *  - Loom: https://www.loom.com/share/<id>?sid=...  →  /embed/<id>
 *  - YouTube: https://www.youtube.com/watch?v=ID  o  youtu.be/ID  →  /embed/ID
 *  - Vimeo: https://vimeo.com/<id>  →  https://player.vimeo.com/video/<id>
 */
export function detectVideoEmbed(url: string): { src: string; provider: "loom" | "youtube" | "vimeo" } | null {
  // Loom
  const loom = url.match(/^https?:\/\/(?:www\.)?loom\.com\/share\/([a-z0-9]+)/i);
  if (loom) return { src: `https://www.loom.com/embed/${loom[1]}`, provider: "loom" };
  // YouTube watch?v=  o  youtu.be/ID
  const yt1 = url.match(/^https?:\/\/(?:www\.)?youtube\.com\/watch\?[^"'\s]*?[&?]v=([\w-]+)/i);
  if (yt1) return { src: `https://www.youtube.com/embed/${yt1[1]}`, provider: "youtube" };
  const yt2 = url.match(/^https?:\/\/youtu\.be\/([\w-]+)/i);
  if (yt2) return { src: `https://www.youtube.com/embed/${yt2[1]}`, provider: "youtube" };
  // Vimeo
  const vm = url.match(/^https?:\/\/(?:www\.)?vimeo\.com\/(\d+)/i);
  if (vm) return { src: `https://player.vimeo.com/video/${vm[1]}`, provider: "vimeo" };
  return null;
}

/**
 * Empuja una URL al contenido del comentario: si es de un proveedor
 * de vídeo reconocido, emite un nodo `iframe` (TipTap lo renderiza
 * como player embebido); si no, lo deja como link normal.
 *
 * `content` y `currentParagraph` son los buffers del builder de doc;
 * `flushParagraph` los vacía. Devuelve true si emitió un iframe
 * (para que el caller no añada también el texto del link).
 */
function tryPushVideoOrLink(
  url: string,
  innerText: string,
  content: any[],
  currentParagraph: any[],
  flushParagraph: () => void
): boolean {
  const video = detectVideoEmbed(url);
  if (video) {
    flushParagraph();
    content.push({
      type: "iframe",
      attrs: { src: video.src, "data-provider": video.provider }
    });
    return true;
  }
  currentParagraph.push({
    type: "text",
    text: innerText || url,
    marks: [{ type: "link", attrs: { href: url, target: "_blank" } }]
  });
  return false;
}

export async function parseAsanaCommentToTipTap(opts: {
  client: AsanaClient;
  workspaceId: string;
  taskLocalId: string;
  story: { gid: string; text?: string; html_text?: string };
  /** GIDs de adjuntos del task cuyo parent es ESTA story (los .txt,
   *  .pdf, etc. arrastrados al cuerpo del comentario). El importer los
   *  pre-calcula recorriendo /tasks/<gid>/attachments con
   *  opt_fields=parent.gid y nos los pasa filtrados. */
  extraAttachmentGids?: string[];
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
  // 1.c) Formato NUEVO de Asana (visto en Autosmotos mayo 2026):
  // las imágenes vienen como <img data-asana-gid="N" data-asana-type="attachment"
  // src="https://asanausercontent.com/..."> directamente embebidas
  // (sin <a> wrapper). El parser anterior las ignoraba completamente.
  for (const m of html.matchAll(
    /<img\s+[^>]*?data-asana-gid="(\d+)"[^>]*?data-asana-type="attachment"[^>]*>/gi
  )) {
    assetIds.add(m[1]);
  }
  for (const m of html.matchAll(
    /<img\s+[^>]*?data-asana-type="attachment"[^>]*?data-asana-gid="(\d+)"[^>]*>/gi
  )) {
    assetIds.add(m[1]);
  }
  // 1.d) <object data-asana-type="attachment"> — Asana lo usa para
  // embeds de Loom y similares dentro del comentario.
  for (const m of html.matchAll(
    /<object\s+[^>]*?data-asana-gid="(\d+)"[^>]*?data-asana-type="attachment"[^>]*>/gi
  )) {
    assetIds.add(m[1]);
  }
  for (const m of html.matchAll(
    /<object\s+[^>]*?data-asana-type="attachment"[^>]*?data-asana-gid="(\d+)"[^>]*>/gi
  )) {
    assetIds.add(m[1]);
  }
  // 1.e) Adjuntos del COMENTARIO (no del html_text). Asana permite
  // arrastrar un .txt / .pdf / cualquier fichero al comentario y los
  // muestra como chips bajo el cuerpo del texto; NO los incluye en
  // html_text.
  //
  // FUENTE A) extraAttachmentGids — el importer las pre-calcula
  //   recorriendo /tasks/<gid>/attachments con parent.gid y nos las
  //   pasa filtradas por story. Es la fuente FIABLE: la usa siempre
  //   que viene poblada.
  // FUENTE B) client.storyAttachments() — fallback vía
  //   /attachments?parent=<story_gid>. Asana no documenta este
  //   parámetro para stories y a veces devuelve [] aunque haya
  //   adjuntos. Lo dejamos como red de seguridad por si llamamos
  //   al parser fuera del importer (debug endpoint, scripts ad-hoc).
  const storyAttachmentIds: string[] = [];
  for (const gid of opts.extraAttachmentGids ?? []) {
    if (gid) {
      storyAttachmentIds.push(gid);
      assetIds.add(gid);
    }
  }
  if (storyAttachmentIds.length === 0) {
    try {
      for await (const att of opts.client.storyAttachments(opts.story.gid)) {
        if (att?.gid) {
          storyAttachmentIds.push(att.gid);
          assetIds.add(att.gid);
        }
      }
    } catch {
      // Sin acceso a /attachments?parent=story → ignorar.
    }
  }

  // 2) Descargar cada asset (en paralelo) y mapear assetId → URL final
  //    + metadatos (isImage, mime, name) para decidir qué nodo TipTap
  //    crear: si es imagen, nodo `image`; si no, párrafo con link de
  //    descarga (PDF, XPS, ZIP, docx...).
  type AssetEntry = { url: string; alt: string; isImage: boolean; mime: string; name: string };
  const assetUrls = new Map<string, AssetEntry | null>();
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
        // Detección de imagen: por content-type del head (preferido)
        // o por extensión del filename como fallback. Cubrir
        // explícitamente XPS, PDF, ZIP, doc, xlsx para que NO entren
        // como imagen rota.
        const ext = (name.split(".").pop() ?? "").toLowerCase();
        const isImageExt = /^(jpe?g|png|webp|gif|bmp|svg|heic)$/i.test(ext);

        if (!isStorageEnabled()) {
          // Sin storage propio, dejamos al menos el download_url de
          // Asana — temporal pero al menos vivos durante la migración.
          assetUrls.set(id, {
            url: downloadUrl,
            alt: name,
            isImage: isImageExt,
            mime: "",
            name
          });
          return;
        }
        const r = await fetch(downloadUrl);
        if (!r.ok) {
          assetUrls.set(id, null);
          return;
        }
        const contentType = r.headers.get("content-type") ?? "application/octet-stream";
        const isImage =
          contentType.startsWith("image/") ||
          (contentType === "application/octet-stream" && isImageExt);
        const buf = Buffer.from(await r.arrayBuffer());
        const s3Key = buildS3Key({
          workspaceId: opts.workspaceId,
          targetType: "COMMENT",
          targetId: opts.taskLocalId,
          filename: name
        });
        await uploadBuffer({ s3Key, body: buf, contentType });
        const publicUrl = await signedDownloadUrl(s3Key);
        assetUrls.set(id, { url: publicUrl, alt: name, isImage, mime: contentType, name });
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

  // Apéndice: adjuntos del comentario que NO aparecen en html_text
  // (los que vienen de /attachments?parent=story_gid). Los añadimos
  // como nodos al final del doc para que el user los vea: si son
  // imágenes → image node; si no → "📎 nombre" como link.
  // Filtramos asset IDs que ya están presentes en el html_text para no
  // duplicar.
  const inlineIds = new Set<string>();
  if (html) {
    for (const m of html.matchAll(/data-asana-gid="(\d+)"/g)) inlineIds.add(m[1]);
    for (const m of html.matchAll(/asset_id=(\d+)/g)) inlineIds.add(m[1]);
  }
  for (const id of storyAttachmentIds) {
    if (inlineIds.has(id)) continue;
    const asset = assetUrls.get(id);
    if (!asset) continue;
    if (!Array.isArray(result.doc.content)) result.doc.content = [];
    if (asset.isImage) {
      result.doc.content.push({
        type: "image",
        attrs: { src: asset.url, alt: asset.alt }
      });
    } else {
      result.doc.content.push({
        type: "paragraph",
        content: [
          {
            type: "text",
            text: `📎 ${asset.name}`,
            marks: [{ type: "link", attrs: { href: asset.url, target: "_blank" } }]
          }
        ]
      });
    }
  }

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
type AssetEntry = { url: string; alt: string; isImage: boolean; mime: string; name: string };

function htmlToTipTap(html: string, assets: Map<string, AssetEntry | null>): any {
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

  // Asana embebe imágenes con <img data-asana-gid="N" data-asana-type=
  // "attachment" src="https://asanausercontent.com/..."> y embeds tipo
  // Loom con <object data-asana-gid="N" data-asana-type="attachment"
  // data="https://www.loom.com/embed/..."></object>. Las normalizamos
  // ANTES del loop principal a <a data-asana-gid="N" data-asana-type=
  // "attachment">alt</a> para que la misma lógica de detección de
  // attachments las pille. Para los <img> que NO tienen data-asana
  // (raros) los dejamos pasar como <a> con el src para que se vea
  // algún placeholder en vez de borrarlas.
  h = h.replace(/<img\s+([^>]*?)\s*\/?>/gi, (_, attrs: string) => {
    const gid = /data-asana-gid="(\d+)"/.exec(attrs)?.[1];
    const type = /data-asana-type="([^"]+)"/.exec(attrs)?.[1];
    const alt = /\balt="([^"]*)"/.exec(attrs)?.[1] ?? "";
    if (type === "attachment" && gid) {
      return `<a data-asana-gid="${gid}" data-asana-type="attachment">${alt || "imagen"}</a>`;
    }
    // <img> sin data-asana: probablemente externo. Lo dejamos como
    // link al src.
    const src = /\bsrc="([^"]+)"/.exec(attrs)?.[1];
    if (src) return `<a href="${src}">${alt || src}</a>`;
    return "";
  });
  h = h.replace(/<object\s+([^>]*?)>([\s\S]*?)<\/object>/gi, (_, attrs: string, inner: string) => {
    const gid = /data-asana-gid="(\d+)"/.exec(attrs)?.[1];
    const type = /data-asana-type="([^"]+)"/.exec(attrs)?.[1];
    // Si el <object> tiene data="https://www.loom.com/embed/..." lo
    // usamos directamente — es ya la URL de embed lista para iframe.
    // Si no, el inner suele tener un <a href=".../share/..."> fallback
    // que también funciona (tryPushVideoOrLink lo convierte a embed).
    const dataAttr = /\bdata="([^"]+)"/.exec(attrs)?.[1];
    if (dataAttr && /^https?:/i.test(dataAttr)) {
      return `<a href="${dataAttr}">${dataAttr}</a>`;
    }
    if (type === "attachment" && gid) {
      const fallbackHref = /<a\s+[^>]*href="([^"]+)"/i.exec(inner)?.[1];
      if (fallbackHref) return `<a href="${fallbackHref}">${fallbackHref}</a>`;
      return `<a data-asana-gid="${gid}" data-asana-type="attachment">embed</a>`;
    }
    return inner;
  });

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
        if (asset.isImage) {
          flushParagraph();
          content.push({ type: "image", attrs: { src: asset.url, alt: asset.alt } });
        } else {
          // Adjunto no-imagen (PDF, XPS, ZIP, docx…). Como nodo
          // imagen daría una imagen rota; lo emitimos como párrafo
          // con link 📎 al fichero. Así el user puede descargarlo.
          flushParagraph();
          content.push({
            type: "paragraph",
            content: [
              {
                type: "text",
                text: `📎 ${asset.name}`,
                marks: [{ type: "link", attrs: { href: asset.url, target: "_blank" } }]
              }
            ]
          });
        }
      } else {
        currentParagraph.push({
          type: "text",
          text: `[adjunto perdido: ${inner || attachmentId}]`
        });
      }
    } else if (href.startsWith("http")) {
      // Link normal — pero antes intentamos detectar si es URL de
      // vídeo de Loom/YouTube/Vimeo. Si lo es, emitimos un nodo
      // `iframe` con el embed; el render del comentario lo pinta
      // como player. Así no perdemos el comportamiento que tiene
      // Asana de mostrar el vídeo directamente.
      tryPushVideoOrLink(href, inner, content, currentParagraph, flushParagraph);
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

function textToTipTap(text: string, assets: Map<string, AssetEntry | null>): any {
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
        if (asset.isImage) {
          content.push({ type: "image", attrs: { src: asset.url, alt: asset.alt } });
        } else {
          content.push({
            type: "paragraph",
            content: [
              {
                type: "text",
                text: `📎 ${asset.name}`,
                marks: [{ type: "link", attrs: { href: asset.url, target: "_blank" } }]
              }
            ]
          });
        }
      } else {
        currentParagraph.push({ type: "text", text: `[adjunto perdido]` });
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
