"use client";

import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";
import Mention from "@tiptap/extension-mention";
import { useEffect, useRef, useState } from "react";
import { FolderOpen, ImagePlus, Loader2, Video, X } from "lucide-react";
import { SlashCommands } from "./SlashCommands";
import { TaskMedia } from "./extensions/TaskMedia";
import { uploadFile } from "@/lib/files/upload-client";
import { mediaKindForMime } from "@/lib/editor/task-media";
import { buildMentionSuggestion, type MentionCandidate } from "@/components/forms/mentionSuggestion";

/**
 * RichTextEditor reutilizable basado en TipTap.
 * No persiste automáticamente — emite `onChange(json)` y el padre decide.
 * Acepta initialContent como JSON de TipTap o como string (texto plano).
 */
export default function RichTextEditor({
  initialContent,
  onChange,
  placeholder = "Escribe… / para insertar bloques, @ para mencionar.",
  minHeight = 120,
  readOnly = false,
  mentionCandidates = [],
  media,
  onUploadingChange
}: {
  initialContent?: any;
  onChange?: (content: any) => void;
  placeholder?: string;
  minHeight?: number;
  readOnly?: boolean;
  mentionCandidates?: MentionCandidate[];
  media?: { enabled: boolean; taskId?: string };
  onUploadingChange?: (uploading: boolean) => void;
}) {
  const candidatesRef = useRef<MentionCandidate[]>(mentionCandidates);
  candidatesRef.current = mentionCandidates;
  const imageInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const [uploads, setUploads] = useState<Array<{ id: string; name: string; progress: number }>>([]);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [attachmentMedia, setAttachmentMedia] = useState<Array<{ id: string; name: string; mimeType: string }>>([]);
  const [attachmentPickerOpen, setAttachmentPickerOpen] = useState(false);
  const attachmentInsertionPos = useRef<number | null>(null);
  const editor = useEditor({
    immediatelyRender: false,
    editable: !readOnly,
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      Placeholder.configure({ placeholder }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Link.configure({ openOnClick: true, autolink: true, linkOnPaste: true }),
      Image.configure({ inline: false, allowBase64: false }),
      TaskMedia,
      SlashCommands,
      Mention.configure({
        HTMLAttributes: { class: "bg-brand-100 text-brand-700 rounded px-1 py-0.5 text-[12px] font-medium" },
        renderText({ node }) {
          return `@${node.attrs.label ?? node.attrs.id}`;
        },
        suggestion: buildMentionSuggestion(() => candidatesRef.current)
      })
    ],
    content: parseInitial(initialContent),
    onUpdate({ editor }) {
      onChange?.(editor.getJSON());
    },
    editorProps: {
      attributes: {
        style: `min-height:${minHeight}px`,
        class:
          "prose prose-sm prose-slate max-w-none focus:outline-none " +
          "[&_h1]:text-xl [&_h1]:font-semibold [&_h1]:mt-3 [&_h1]:mb-2 " +
          "[&_h2]:text-lg [&_h2]:font-semibold [&_h2]:mt-3 [&_h2]:mb-2 " +
          "[&_h3]:text-base [&_h3]:font-semibold [&_h3]:mt-2 [&_h3]:mb-1 " +
          "[&_p]:my-1.5 [&_p]:leading-relaxed " +
          "[&_ul]:list-disc [&_ul]:ml-5 [&_ol]:list-decimal [&_ol]:ml-5 " +
          "[&_blockquote]:border-l-4 [&_blockquote]:border-slate-300 [&_blockquote]:pl-3 [&_blockquote]:italic [&_blockquote]:text-slate-600 " +
          "[&_code]:bg-slate-100 [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-[12px] " +
          "[&_a]:text-brand-600 [&_a]:underline [&_a]:cursor-pointer " +
          "[&_ul[data-type='taskList']]:list-none [&_ul[data-type='taskList']]:ml-0 " +
          "[&_li[data-type='taskItem']]:flex [&_li[data-type='taskItem']]:gap-2 [&_li[data-type='taskItem']]:items-start"
      }
    }
  });

  useEffect(() => {
    if (!editor) return;
    const incoming = parseInitial(initialContent);
    if (JSON.stringify(incoming) === JSON.stringify(editor.getJSON())) return;
    editor.commands.setContent(incoming, false);
  }, [editor, initialContent]);

  useEffect(() => onUploadingChange?.(uploads.length > 0), [uploads.length, onUploadingChange]);

  async function insertFiles(files: FileList | File[] | null) {
    if (!editor || !files) return;
    const accepted = Array.from(files).map((file) => ({
      file,
      kind: mediaKindForMime(file.type),
      uploadId: Math.random().toString(36).slice(2)
    }));
    // Clicking the picker moves focus away from TipTap. Keep the original
    // caret position so uploaded media lands where the user requested it.
    let insertionPos = editor.state.selection.to;
    setMediaError(null);
    setUploads(
      accepted
        .filter((item) => item.kind)
        .map((item) => ({ id: item.uploadId, name: item.file.name, progress: 0 }))
    );
    for (const { file, kind, uploadId } of accepted) {
      if (!kind) {
        setMediaError(`Formato no compatible: ${file.name}. Usa JPG, PNG, GIF, WebP, MP4 o WebM.`);
        continue;
      }
      try {
        const uploaded = await uploadFile(file, {
          targetTaskId: media?.taskId,
          purpose: "TASK_DESCRIPTION",
          onProgress: (progress) =>
            setUploads((current) => current.map((item) => (item.id === uploadId ? { ...item, progress } : item)))
        });
        editor
          .chain()
          .insertContentAt(insertionPos, [
            {
              type: "taskMedia",
              attrs: {
                fileId: uploaded.id,
                kind,
                name: uploaded.name,
                mimeType: uploaded.mimeType,
                alt: kind === "image" ? uploaded.name : undefined
              }
            },
            { type: "paragraph" }
          ])
          .run();
        // A block atom has nodeSize 1 and the trailing empty paragraph 2.
        insertionPos += 3;
      } catch (reason: any) {
        setMediaError(reason?.message ?? `No se pudo subir ${file.name}`);
      } finally {
        setUploads((current) => current.filter((item) => item.id !== uploadId));
      }
    }
  }

  async function openAttachmentPicker() {
    if (!editor || !media?.taskId) return;
    attachmentInsertionPos.current = editor.state.selection.to;
    setMediaError(null);
    try {
      const response = await fetch(`/api/v1/files?targetType=TASK&targetId=${encodeURIComponent(media.taskId)}`);
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error?.message ?? "No se pudieron cargar los adjuntos");
      setAttachmentMedia(
        (body.items ?? [])
          .filter((item: any) => mediaKindForMime(item.mimeType))
          .map((item: any) => ({ id: item.id, name: item.name, mimeType: item.mimeType }))
      );
      setAttachmentPickerOpen(true);
    } catch (reason: any) {
      setMediaError(reason?.message ?? "No se pudieron cargar los adjuntos");
    }
  }

  function insertAttachment(item: { id: string; name: string; mimeType: string }) {
    if (!editor) return;
    const kind = mediaKindForMime(item.mimeType);
    if (!kind) return;
    const pos = attachmentInsertionPos.current ?? editor.state.selection.to;
    editor.commands.insertContentAt(pos, [
      { type: "taskMedia", attrs: { fileId: item.id, kind, name: item.name, mimeType: item.mimeType, alt: kind === "image" ? item.name : undefined } },
      { type: "paragraph" }
    ]);
    setAttachmentPickerOpen(false);
  }

  return (
    <div
      onPaste={(event) => {
        if (!media?.enabled) return;
        const files = Array.from(event.clipboardData?.files ?? []);
        if (files.length) {
          event.preventDefault();
          void insertFiles(files);
        }
      }}
      onDragOver={(event) => media?.enabled && event.preventDefault()}
      onDrop={(event) => {
        if (!media?.enabled || !event.dataTransfer?.files?.length) return;
        event.preventDefault();
        void insertFiles(event.dataTransfer.files);
      }}
    >
      <EditorContent editor={editor} />
      {media?.enabled && !readOnly && (
        <div className="mt-3 border-t pt-2">
          <input ref={imageInputRef} type="file" multiple accept="image/jpeg,image/png,image/gif,image/webp" className="hidden" onChange={(event) => { void insertFiles(event.target.files); event.currentTarget.value = ""; }} />
          <input ref={videoInputRef} type="file" multiple accept="video/mp4,video/webm" className="hidden" onChange={(event) => { void insertFiles(event.target.files); event.currentTarget.value = ""; }} />
          <div className="flex flex-wrap items-center gap-1.5">
            <button type="button" onClick={() => imageInputRef.current?.click()} disabled={uploads.length > 0} className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-50">
              <ImagePlus className="h-4 w-4" /> Imagen
            </button>
            <button type="button" onClick={() => videoInputRef.current?.click()} disabled={uploads.length > 0} className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-50">
              <Video className="h-4 w-4" /> Vídeo
            </button>
            {media.taskId && (
              <button type="button" onClick={() => void openAttachmentPicker()} disabled={uploads.length > 0} className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-50">
                <FolderOpen className="h-4 w-4" /> Desde adjuntos
              </button>
            )}
            <span className="text-[11px] text-slate-400">También puedes pegar o arrastrar archivos al punto del texto.</span>
          </div>
          {attachmentPickerOpen && (
            <div className="mt-2 max-h-48 space-y-1 overflow-y-auto rounded-lg border bg-white p-2">
              {attachmentMedia.length ? attachmentMedia.map((item) => (
                <button key={item.id} type="button" onClick={() => insertAttachment(item)} className="block w-full truncate rounded px-2 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-100">
                  {item.name}
                </button>
              )) : <div className="px-2 py-1 text-xs text-slate-400">No hay imágenes o vídeos adjuntos.</div>}
            </div>
          )}
          {uploads.map((upload) => (
            <div key={upload.id} className="mt-2 flex items-center gap-2 text-xs text-slate-600">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              <span className="min-w-0 flex-1 truncate">{upload.name}</span>
              <div className="h-1.5 w-24 overflow-hidden rounded bg-slate-100"><div className="h-full bg-brand-500" style={{ width: `${upload.progress}%` }} /></div>
              <span>{upload.progress}%</span>
            </div>
          ))}
          {mediaError && <div className="mt-2 flex items-center gap-1 text-xs text-rose-600"><X className="h-3.5 w-3.5" /> {mediaError}</div>}
        </div>
      )}
    </div>
  );
}

function parseInitial(content: any) {
  if (!content) return { type: "doc", content: [{ type: "paragraph" }] };
  if (typeof content === "string") {
    if (content.trim().startsWith("{")) {
      try {
        return JSON.parse(content);
      } catch {
        // fallthrough — tratamos como texto plano
      }
    }
    return {
      type: "doc",
      content: content
        .split("\n")
        .filter(Boolean)
        .map((line) => ({ type: "paragraph", content: textToTiptapNodes(line) }))
    };
  }
  return content;
}

/** Texto plano → nodos TipTap con las URLs (http/https/www) marcadas como
 *  enlace, para que las descripciones importadas con URLs sueltas sean
 *  clicables (openOnClick). No genera nodos de texto vacíos. */
function textToTiptapNodes(line: string): any[] {
  const nodes: any[] = [];
  const re = /(https?:\/\/[^\s]+|www\.[^\s]+)/gi;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) {
    if (m.index > last) nodes.push({ type: "text", text: line.slice(last, m.index) });
    let url = m[0];
    let tail = "";
    const t = url.match(/[).,;:!?]+$/);
    if (t) {
      tail = t[0];
      url = url.slice(0, -tail.length);
    }
    const href = url.startsWith("http") ? url : `https://${url}`;
    nodes.push({ type: "text", text: url, marks: [{ type: "link", attrs: { href } }] });
    if (tail) nodes.push({ type: "text", text: tail });
    last = m.index + m[0].length;
  }
  if (last < line.length) nodes.push({ type: "text", text: line.slice(last) });
  return nodes.length ? nodes : [{ type: "text", text: line }];
}
