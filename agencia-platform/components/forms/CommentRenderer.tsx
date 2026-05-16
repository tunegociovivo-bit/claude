"use client";

import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";
import Mention from "@tiptap/extension-mention";

/**
 * Render read-only de un comentario. Acepta:
 *  - string que parsea como JSON de TipTap (formato nuevo con imágenes
 *    y links inline)
 *  - string de texto plano (formato legacy)
 *
 * Cuando el body no es JSON válido se renderiza como texto plano
 * respetando saltos de línea (whitespace-pre-wrap).
 */
export default function CommentRenderer({ body }: { body: string }) {
  const parsed = tryParseDoc(body);

  // Hooks deben llamarse incondicionalmente. Si parsed es null pasamos
  // null al editor y no renderizamos EditorContent abajo.
  const editor = useEditor({
    immediatelyRender: false,
    editable: false,
    extensions: [
      StarterKit.configure({ heading: false }),
      Link.configure({ openOnClick: true, autolink: true }),
      Image.configure({ inline: false, allowBase64: false }),
      // En readonly el suggestion no se usa, pero necesitamos la
      // extensión registrada para que TipTap entienda el nodo `mention`
      // del JSON y lo pinte con la pill.
      Mention.configure({
        HTMLAttributes: { class: "bg-brand-100 text-brand-700 rounded px-1 py-0.5 text-[12px] font-medium" },
        renderText({ node }) {
          return `@${node.attrs.label ?? node.attrs.id}`;
        }
      })
    ],
    content: parsed ?? { type: "doc", content: [{ type: "paragraph" }] },
    editorProps: {
      attributes: {
        class:
          "prose prose-sm prose-slate max-w-none focus:outline-none " +
          "[&_p]:my-1 [&_p]:leading-relaxed " +
          "[&_ul]:list-disc [&_ul]:ml-5 [&_ol]:list-decimal [&_ol]:ml-5 " +
          "[&_a]:text-brand-600 [&_a]:underline " +
          "[&_img]:max-w-full [&_img]:rounded-md [&_img]:my-2"
      }
    }
  });

  if (parsed) return <EditorContent editor={editor} />;
  return (
    <p className="text-sm text-slate-700 whitespace-pre-wrap">{body}</p>
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
