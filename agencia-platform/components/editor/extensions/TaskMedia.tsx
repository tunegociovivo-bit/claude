"use client";

import { Node, mergeAttributes } from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import { useEffect, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import type { TaskMediaAttrs } from "@/lib/editor/task-media";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    taskMedia: {
      insertTaskMedia: (attrs: TaskMediaAttrs) => ReturnType;
    };
  }
}

function TaskMediaView({ node, selected }: NodeViewProps) {
  const attrs = node.attrs as TaskMediaAttrs;
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    fetch(`/api/v1/files/${encodeURIComponent(attrs.fileId)}`, { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json().catch(() => null);
        if (!response.ok || !data?.url) throw new Error(data?.error?.message ?? "No se pudo abrir el archivo");
        if (!cancelled) setUrl(data.url);
      })
      .catch((reason) => !cancelled && setError(reason?.message ?? "No se pudo abrir el archivo"));
    return () => {
      cancelled = true;
    };
  }, [attrs.fileId, attempt]);

  return (
    <NodeViewWrapper
      className={`my-3 overflow-hidden rounded-xl border bg-slate-50 ${selected ? "ring-2 ring-brand-500" : "border-slate-200"}`}
      data-file-id={attrs.fileId}
    >
      {!url && !error && (
        <div className="flex min-h-28 items-center justify-center gap-2 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Cargando {attrs.kind === "video" ? "vídeo" : "imagen"}…
        </div>
      )}
      {error && (
        <button type="button" onClick={() => setAttempt((value) => value + 1)} className="flex min-h-24 w-full items-center justify-center gap-2 text-sm text-rose-600">
          <RefreshCw className="h-4 w-4" /> {error}. Reintentar
        </button>
      )}
      {url && attrs.kind === "image" && (
        <a href={url} target="_blank" rel="noreferrer" contentEditable={false}>
          <img src={url} alt={attrs.alt || attrs.name || "Imagen de la tarea"} className="mx-auto max-h-[520px] w-auto max-w-full object-contain" />
        </a>
      )}
      {url && attrs.kind === "video" && (
        <video src={url} controls playsInline preload="metadata" className="max-h-[520px] w-full bg-black" contentEditable={false} />
      )}
      {attrs.name && <div className="truncate border-t bg-white px-3 py-1.5 text-xs text-slate-500">{attrs.name}</div>}
    </NodeViewWrapper>
  );
}

export const TaskMedia = Node.create({
  name: "taskMedia",
  group: "block",
  atom: true,
  draggable: true,
  selectable: true,
  addAttributes() {
    return {
      fileId: { default: null },
      kind: { default: "image" },
      name: { default: null },
      mimeType: { default: null },
      alt: { default: null }
    };
  },
  parseHTML() {
    return [{ tag: 'figure[data-type="task-media"]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["figure", mergeAttributes(HTMLAttributes, { "data-type": "task-media" })];
  },
  addCommands() {
    return {
      insertTaskMedia:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs })
    };
  },
  addNodeView() {
    return ReactNodeViewRenderer(TaskMediaView);
  }
});
