"use client";

import { useEffect, useRef, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";
import Mention from "@tiptap/extension-mention";
import { Node, mergeAttributes } from "@tiptap/core";
import Lightbox from "@/components/Lightbox";
import type { ReactNode } from "react";

/** Convierte un texto plano en nodos React con los enlaces (http/https/www)
 *  clicables. La puntuación final típica (.,;:) no se incluye en el enlace. */
function linkify(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(https?:\/\/[^\s<]+|www\.[^\s<]+)/gi;
  let last = 0;
  let key = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    let url = m[0];
    let tail = "";
    const trail = url.match(/[).,;:!?]+$/);
    if (trail) {
      tail = trail[0];
      url = url.slice(0, -tail.length);
    }
    const href = url.startsWith("http") ? url : `https://${url}`;
    out.push(
      <a
        key={key++}
        href={href}
        target="_blank"
        rel="noreferrer"
        className="text-brand-600 underline break-all cursor-pointer"
        onClick={(e) => e.stopPropagation()}
      >
        {url}
      </a>
    );
    if (tail) out.push(tail);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/**
 * Nodo `iframe` para embeber vídeos (Loom, YouTube, Vimeo) dentro
 * de un comentario importado de Asana. El importer detecta las URLs
 * de video y emite { type: "iframe", attrs: { src, "data-provider" } }
 * — sin esta extensión TipTap no sabría qué hacer con ese tipo y
 * lo descartaría en silencio (volveríamos al problema de ver solo
 * la URL). El render es un <iframe> con aspecto 16:9 sandbox-ed.
 */
const IframeEmbed = Node.create({
  name: "iframe",
  group: "block",
  atom: true,
  draggable: false,
  selectable: false,
  addAttributes() {
    return {
      src: { default: "" },
      "data-provider": { default: null }
    };
  },
  parseHTML() {
    return [{ tag: "iframe" }];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      { class: "video-embed relative aspect-video my-2 rounded-md overflow-hidden bg-slate-100" },
      [
        "iframe",
        mergeAttributes(HTMLAttributes, {
          frameborder: "0",
          allow: "autoplay; fullscreen; picture-in-picture; clipboard-write",
          allowfullscreen: "true",
          class: "absolute inset-0 w-full h-full"
        })
      ]
    ];
  }
});

/**
 * Render read-only de un comentario. Acepta:
 *  - `bodyJson`: doc TipTap directo (formato nuevo, lo que devuelve la
 *    API en /api/v1/tasks/[id]/comments). Se prefiere si está presente.
 *  - `body`: string. Si parsea como JSON de TipTap (legacy con todo
 *    serializado en `body`), lo usa. Si no, lo pinta como texto plano.
 *
 * IMPORTANTE: los comentarios importados de Asana con imágenes
 * inline tienen `body=""` (Asana puede mandar solo imagen sin texto)
 * y todo el contenido rico en `bodyJson`. Si solo miráramos `body`
 * el comentario aparecería vacío — bug visto tras la importación de
 * Autosmotos en mayo 2026.
 *
 * Las imágenes inline son clicables y abren un Lightbox a tamaño
 * real con botón de descarga y "abrir en pestaña nueva".
 */
export default function CommentRenderer({ body, bodyJson }: { body: string; bodyJson?: any }) {
  // Preferencia: doc rico vía bodyJson > JSON serializado en body > texto plano.
  const parsed = bodyJson && bodyJson.type === "doc" ? bodyJson : tryParseDoc(body);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [lightbox, setLightbox] = useState<{ src: string; alt: string | null } | null>(null);

  const editor = useEditor({
    immediatelyRender: false,
    editable: false,
    extensions: [
      // Heading habilitado: los resúmenes de reunión incluyen
      // secciones como "👥 Participantes" como heading nivel 3.
      // Sin esto, el doc se considera inválido y el comentario
      // aparece vacío aunque esté guardado.
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      Link.configure({ openOnClick: true, autolink: true }),
      Image.configure({
        inline: false,
        allowBase64: false,
        HTMLAttributes: { class: "cursor-zoom-in" }
      }),
      // En readonly el suggestion no se usa, pero necesitamos la
      // extensión registrada para que TipTap entienda el nodo `mention`
      // del JSON y lo pinte con la pill.
      Mention.configure({
        HTMLAttributes: { class: "bg-brand-100 text-brand-700 rounded px-1 py-0.5 text-[12px] font-medium" },
        renderText({ node }) {
          return `@${node.attrs.label ?? node.attrs.id}`;
        }
      }),
      IframeEmbed
    ],
    content: parsed ?? { type: "doc", content: [{ type: "paragraph" }] },
    editorProps: {
      attributes: {
        class:
          "prose prose-sm prose-slate max-w-none focus:outline-none " +
          "[&_p]:my-1 [&_p]:leading-relaxed " +
          // Headings — los resúmenes de reunión los usan como
          // separadores de sección. h3 destacado, h2 más grande,
          // h1 reservado para casos raros.
          "[&_h1]:text-base [&_h1]:font-bold [&_h1]:mt-3 [&_h1]:mb-1 " +
          "[&_h2]:text-sm [&_h2]:font-bold [&_h2]:mt-3 [&_h2]:mb-1 " +
          "[&_h3]:text-sm [&_h3]:font-semibold [&_h3]:mt-2 [&_h3]:mb-1 [&_h3]:text-slate-800 " +
          "[&_ul]:list-disc [&_ul]:ml-5 [&_ol]:list-decimal [&_ol]:ml-5 " +
          "[&_blockquote]:border-l-2 [&_blockquote]:border-slate-300 [&_blockquote]:pl-3 [&_blockquote]:my-2 [&_blockquote]:text-slate-600 [&_blockquote]:text-[12px] " +
          "[&_a]:text-brand-600 [&_a]:underline [&_a]:cursor-pointer " +
          "[&_img]:max-w-full [&_img]:rounded-md [&_img]:my-2 [&_img]:cursor-zoom-in"
      }
    }
  });

  // Delegación de click: cuando se pulsa una imagen dentro del prose,
  // abrimos el lightbox. Usamos el wrapper externo (no editor.view.dom
  // directamente) para sobrevivir a re-renders.
  useEffect(() => {
    const node = wrapperRef.current;
    if (!node) return;
    function onClick(e: Event) {
      const t = e.target as HTMLElement;
      if (t && t.tagName === "IMG") {
        e.preventDefault();
        e.stopPropagation();
        const img = t as HTMLImageElement;
        setLightbox({ src: img.currentSrc || img.src, alt: img.getAttribute("alt") });
      }
    }
    node.addEventListener("click", onClick);
    return () => node.removeEventListener("click", onClick);
  }, [parsed]);

  // Si el doc parsed está vacío (un solo párrafo vacío) pero hay body
  // de texto plano, preferimos pintarlo como texto. Cubre comentarios
  // viejos con body de texto + bodyJson auto-generado vacío.
  const isEmptyDoc =
    parsed &&
    Array.isArray(parsed.content) &&
    parsed.content.length === 1 &&
    parsed.content[0].type === "paragraph" &&
    !parsed.content[0].content?.length;

  return (
    <>
      <div ref={wrapperRef}>
        {parsed && !isEmptyDoc ? (
          <EditorContent editor={editor} />
        ) : body ? (
          <p className="text-sm text-slate-700 whitespace-pre-wrap">{linkify(body)}</p>
        ) : (
          <p className="text-xs text-slate-400 italic">(Comentario sin contenido visible)</p>
        )}
      </div>
      <Lightbox
        src={lightbox?.src ?? null}
        alt={lightbox?.alt ?? null}
        onClose={() => setLightbox(null)}
      />
    </>
  );
}

function tryParseDoc(body: string): any | null {
  if (!body) return null;
  const trimmed = body.trim();
  if (!trimmed.startsWith("{")) return null;
  try {
    const j = JSON.parse(trimmed);
    if (j && j.type === "doc" && Array.isArray(j.content)) return j;
    return null;
  } catch {
    return null;
  }
}
