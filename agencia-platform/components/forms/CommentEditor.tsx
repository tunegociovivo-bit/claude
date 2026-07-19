"use client";

import { useRef, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";
import Mention from "@tiptap/extension-mention";
import { Loader2, ImagePlus, Paperclip, Send, X } from "lucide-react";
import { buildMentionSuggestion, type MentionCandidate } from "@/components/forms/mentionSuggestion";

/**
 * Editor rich para escribir comentarios de tarea. Soporta texto con
 * formato, @menciones, imágenes inline y adjuntos. Los adjuntos no
 * imagen aparecen como un párrafo con icono + nombre + tamaño que
 * funciona como link de descarga. CommentRenderer reconoce este
 * patrón y lo pinta como tarjeta.
 *
 * Las subidas se hacen con XMLHttpRequest para tener barra de
 * progreso real; reusan el endpoint /api/v1/files/upload-url ya
 * existente y registran metadata en /api/v1/files con
 * targetType=TASK para que aparezcan también en AttachmentList.
 */
export default function CommentEditor({
  taskId,
  onSubmit,
  submitting,
  mentionCandidates = [],
  placeholder = "Escribe un comentario… arrastra imágenes, pega archivos o escribe @ para mencionar."
}: {
  taskId: string;
  onSubmit: (doc: any) => void | Promise<void>;
  submitting?: boolean;
  mentionCandidates?: MentionCandidate[];
  placeholder?: string;
}) {
  const candidatesRef = useRef<MentionCandidate[]>(mentionCandidates);
  candidatesRef.current = mentionCandidates;

  const [error, setError] = useState<string | null>(null);
  const [uploads, setUploads] = useState<UploadState[]>([]);
  const imgRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      // Heading habilitado para que los resúmenes de reunión (que
      // tienen secciones "👥 Participantes", "✓ Decisiones", etc.)
      // se rendericen correctamente. Sin heading, TipTap rechaza
      // el nodo y el comentario queda vacío visualmente.
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      Placeholder.configure({ placeholder }),
      Link.configure({ openOnClick: false, autolink: true }),
      Image.configure({ inline: false, allowBase64: false }),
      Mention.configure({
        HTMLAttributes: { class: "bg-brand-100 text-brand-700 rounded px-1 py-0.5 text-[12px] font-medium" },
        renderText({ node }) {
          return `@${node.attrs.label ?? node.attrs.id}`;
        },
        suggestion: buildMentionSuggestion(() => candidatesRef.current)
      })
    ],
    content: { type: "doc", content: [{ type: "paragraph" }] },
    editorProps: {
      attributes: {
        class:
          "prose prose-sm prose-slate max-w-none focus:outline-none min-h-[80px] " +
          "[&_p]:my-1.5 [&_p]:leading-relaxed " +
          "[&_ul]:list-disc [&_ul]:ml-5 [&_ol]:list-decimal [&_ol]:ml-5 " +
          "[&_a]:text-brand-600 [&_a]:underline [&_a]:cursor-pointer " +
          "[&_img]:max-w-full [&_img]:rounded-md [&_img]:my-2"
      }
    }
  });

  async function uploadAndInsert(file: File) {
    if (!editor || !taskId) return;
    setError(null);
    const uploadId = Math.random().toString(36).slice(2);
    setUploads((prev) => [...prev, { id: uploadId, name: file.name, progress: 0, sizeBytes: file.size }]);

    try {
      // Subida vía proxy del servidor (multipart POST). Evita CORS
      // contra R2 que requeriría configuración del bucket. Más simple
      // y robusto para archivos <50 MB; el server traga el binario y
      // lo reenvía con sus credenciales.
      //
      // XMLHttpRequest sigue ofreciéndonos onprogress (fetch no lo
      // expone aún en navegadores estables).
      const form = new FormData();
      form.append("file", file, file.name);
      form.append("targetType", "TASK");
      form.append("targetId", taskId);

      const meta = await new Promise<any>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", "/api/v1/files/upload");
        xhr.upload.onprogress = (e) => {
          if (!e.lengthComputable) return;
          const pct = Math.round((e.loaded / e.total) * 100);
          setUploads((prev) => prev.map((u) => (u.id === uploadId ? { ...u, progress: pct } : u)));
        };
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            try {
              resolve(JSON.parse(xhr.responseText));
            } catch {
              reject(new Error("Respuesta del servidor inválida"));
            }
          } else {
            let msg = `Upload ${xhr.status}`;
            try {
              const j = JSON.parse(xhr.responseText);
              if (j?.error?.message) msg = j.error.message;
              else if (j?.message) msg = j.message;
            } catch {}
            reject(new Error(msg));
          }
        };
        xhr.onerror = () => reject(new Error("Error de red al subir"));
        xhr.send(form);
      });

      const finalUrl = meta?.url as string | undefined;
      if (!finalUrl) throw new Error("Sin URL pública del archivo");

      // 4. Insertar en el doc.
      if ((file.type || "").startsWith("image/")) {
        editor.chain().focus().setImage({ src: finalUrl, alt: file.name }).run();
      } else {
        // Patrón "tarjeta de archivo": párrafo aislado con un único
        // link cuyo TEXTO empieza con 📎 y contiene name · size. El
        // CommentRenderer lo detecta y lo pinta como card.
        editor
          .chain()
          .focus()
          .insertContent({
            type: "paragraph",
            content: [
              {
                type: "text",
                text: `📎 ${file.name} · ${formatSize(file.size)}`,
                marks: [
                  {
                    type: "link",
                    attrs: { href: finalUrl, target: "_blank", rel: "noopener noreferrer" }
                  }
                ]
              }
            ]
          })
          .run();
      }
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setUploads((prev) => prev.filter((u) => u.id !== uploadId));
    }
  }

  async function handleFiles(files: FileList | null) {
    if (!files) return;
    for (const f of Array.from(files)) await uploadAndInsert(f);
  }

  async function handlePaste(ev: React.ClipboardEvent) {
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

  const anyUploading = uploads.length > 0;

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

      {uploads.length > 0 && (
        <div className="mt-2 space-y-1.5">
          {uploads.map((u) => (
            <div key={u.id} className="flex items-center gap-2 text-[11px] text-slate-600">
              <Loader2 className="h-3 w-3 animate-spin shrink-0" />
              <span className="flex-1 truncate">
                {u.name} ({formatSize(u.sizeBytes)})
              </span>
              <div className="w-24 h-1.5 bg-slate-100 rounded overflow-hidden">
                <div
                  className="h-full bg-brand-500 transition-all"
                  style={{ width: `${u.progress}%` }}
                />
              </div>
              <span className="w-8 text-right">{u.progress}%</span>
            </div>
          ))}
        </div>
      )}

      <div className="mt-2 flex items-center gap-1 border-t pt-2">
        {/* Inputs ocultos: uno solo acepta imágenes, otro cualquier
            archivo. Así "Imagen" abre el picker filtrado y los
            usuarios no se equivocan. */}
        <input
          ref={imgRef}
          type="file"
          multiple
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            handleFiles(e.target.files);
            if (imgRef.current) imgRef.current.value = "";
          }}
        />
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
          onClick={() => imgRef.current?.click()}
          disabled={anyUploading}
          className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs text-slate-600 hover:bg-slate-100 disabled:opacity-50"
          title="Insertar imagen (también puedes pegar con Ctrl+V o arrastrar)"
        >
          <ImagePlus className="h-3.5 w-3.5" /> Imagen
        </button>
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={anyUploading}
          className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs text-slate-600 hover:bg-slate-100 disabled:opacity-50"
          title="Adjuntar archivo (PDF, doc, vídeo, lo que sea)"
        >
          <Paperclip className="h-3.5 w-3.5" /> Archivo
        </button>
        {error && (
          <span className="text-[11px] text-rose-600 ml-1 truncate inline-flex items-center gap-1">
            <X className="h-3 w-3" /> {error}
          </span>
        )}
        <div className="ml-auto" />
        <button
          type="button"
          onClick={submit}
          disabled={submitting || anyUploading}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-brand-600 hover:bg-brand-700 text-white text-xs font-medium disabled:opacity-50"
        >
          {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
          Enviar
        </button>
      </div>
    </div>
  );
}

type UploadState = { id: string; name: string; progress: number; sizeBytes: number };

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
