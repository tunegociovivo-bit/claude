"use client";

import { useRef, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";
import { Loader2, ImagePlus, Paperclip, Send } from "lucide-react";

/**
 * Editor rich para escribir comentarios de tarea. Soporta texto con
 * formato, imágenes inline (cualquier punto del texto) y links a
 * archivos adjuntos. Las subidas usan el endpoint existente
 * `/api/v1/files/upload-url` que ya devuelve URL firmada para R2/S3.
 *
 * El contenido se emite como JSON de TipTap. El padre lo serializa
 * (JSON.stringify) y lo envía al endpoint de comentarios tal cual; el
 * render readonly se hace con CommentRenderer.
 */
export default function CommentEditor({
  taskId,
  onSubmit,
  submitting,
  placeholder = "Escribe un comentario… arrastra imágenes o pega archivos."
}: {
  taskId: string;
  onSubmit: (doc: any) => void | Promise<void>;
  submitting?: boolean;
  placeholder?: string;
}) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({ heading: false }),
      Placeholder.configure({ placeholder }),
      Link.configure({ openOnClick: false, autolink: true }),
      Image.configure({ inline: false, allowBase64: false })
    ],
    content: { type: "doc", content: [{ type: "paragraph" }] },
    editorProps: {
      attributes: {
        class:
          "prose prose-sm prose-slate max-w-none focus:outline-none min-h-[80px] " +
          "[&_p]:my-1.5 [&_p]:leading-relaxed " +
          "[&_ul]:list-disc [&_ul]:ml-5 [&_ol]:list-decimal [&_ol]:ml-5 " +
          "[&_a]:text-brand-600 [&_a]:underline " +
          "[&_img]:max-w-full [&_img]:rounded-md [&_img]:my-2"
      }
    }
  });

  async function uploadAndInsert(file: File) {
    if (!editor || !taskId) return;
    setError(null);
    setUploading(true);
    try {
      const urlRes = await fetch("/api/v1/files/upload-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: file.name,
          contentType: file.type || "application/octet-stream",
          sizeBytes: file.size,
          targetType: "TASK",
          targetId: taskId
        })
      });
      if (!urlRes.ok) throw new Error(`upload-url ${urlRes.status}`);
      const { uploadUrl, s3Key, publicUrl } = await urlRes.json();
      // Subida al storage firmado
      const put = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file
      });
      if (!put.ok) throw new Error(`PUT ${put.status}`);
      // Registrar metadata para que aparezca también en AttachmentList
      const metaRes = await fetch("/api/v1/files", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: file.name,
          mimeType: file.type || "application/octet-stream",
          sizeBytes: file.size,
          s3Key,
          targetType: "TASK",
          targetId: taskId
        })
      });
      const meta = metaRes.ok ? await metaRes.json() : null;
      const finalUrl = (meta?.url ?? publicUrl) as string | undefined;
      if (!finalUrl) throw new Error("Sin URL pública");
      if ((file.type || "").startsWith("image/")) {
        editor.chain().focus().setImage({ src: finalUrl, alt: file.name }).run();
      } else {
        // Archivo no-imagen → link inline al final del párrafo actual
        editor
          .chain()
          .focus()
          .insertContent({
            type: "paragraph",
            content: [
              {
                type: "text",
                text: `📎 ${file.name}`,
                marks: [{ type: "link", attrs: { href: finalUrl, target: "_blank" } }]
              }
            ]
          })
          .run();
      }
    } catch (e: any) {
      setError(e.message ?? String(e));
    } finally {
      setUploading(false);
    }
  }

  async function handleFiles(files: FileList | null) {
    if (!files) return;
    for (const f of Array.from(files)) await uploadAndInsert(f);
  }

  async function handlePaste(ev: React.ClipboardEvent) {
    // Permite Ctrl+V de imagen directamente.
    const items = Array.from(ev.clipboardData?.items ?? []);
    const files: File[] = [];
    for (const it of items) {
      if (it.kind === "file") {
        const f = it.getAsFile();
        if (f) files.push(f);
      }
    }
    if (files.length === 0) return;
    ev.preventDefault();
    for (const f of files) await uploadAndInsert(f);
  }

  async function submit() {
    if (!editor) return;
    const doc = editor.getJSON();
    // Si el doc está vacío (solo un párrafo vacío), no enviamos.
    const empty =
      !doc.content ||
      doc.content.length === 0 ||
      (doc.content.length === 1 && doc.content[0].type === "paragraph" && !doc.content[0].content);
    if (empty) return;
    await onSubmit(doc);
    editor.commands.clearContent();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      submit();
    }
  }

  return (
    <div
      className="rounded-lg border bg-white p-2 focus-within:ring-2 focus-within:ring-brand-500"
      onPaste={handlePaste}
      onKeyDown={onKeyDown}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        handleFiles(e.dataTransfer?.files ?? null);
      }}
    >
      <EditorContent editor={editor} />
      <div className="mt-2 flex items-center gap-1 border-t pt-2">
        <input
          ref={fileRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            handleFiles(e.target.files);
            if (fileRef.current) fileRef.current.value = "";
          }}
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs text-slate-600 hover:bg-slate-100 disabled:opacity-50"
          title="Insertar imagen"
        >
          <ImagePlus className="h-3.5 w-3.5" /> Imagen
        </button>
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs text-slate-600 hover:bg-slate-100 disabled:opacity-50"
          title="Adjuntar archivo"
        >
          <Paperclip className="h-3.5 w-3.5" /> Archivo
        </button>
        {uploading && (
          <span className="text-[11px] text-slate-500 inline-flex items-center gap-1 ml-1">
            <Loader2 className="h-3 w-3 animate-spin" /> subiendo…
          </span>
        )}
        {error && <span className="text-[11px] text-rose-600 ml-1 truncate">{error}</span>}
        <div className="ml-auto" />
        <button
          type="button"
          onClick={submit}
          disabled={submitting || uploading}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-brand-600 hover:bg-brand-700 text-white text-xs font-medium disabled:opacity-50"
        >
          {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
          Enviar
        </button>
      </div>
    </div>
  );
}
