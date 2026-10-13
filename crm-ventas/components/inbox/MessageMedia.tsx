"use client";

import { useEffect, useState } from "react";
import clsx from "clsx";
import { Download, FileText, ImageOff, Loader2, Mic, Video, X } from "lucide-react";

export type MediaMeta = {
  kind: "image" | "video" | "voice" | "audio" | "document" | "sticker";
  mimetype: string;
  filename: string | null;
  caption: string;
  size: number | null;
  hasFile: boolean;
  hasThumb: boolean;
  error: string | null;
  pending?: boolean;
};

const KIND_TEXT: Record<MediaMeta["kind"], string> = {
  image: "Foto",
  video: "Vídeo",
  voice: "Nota de voz",
  audio: "Audio",
  document: "Documento",
  sticker: "Sticker",
};

function sizeText(size: number | null) {
  if (!size) return "";
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / 1048576).toFixed(1)} MB`;
}

export function mediaUrl(messageId: string, opts: { thumb?: boolean; download?: boolean } = {}) {
  const q = new URLSearchParams();
  if (opts.thumb) q.set("v", "thumb");
  if (opts.download) q.set("download", "1");
  const qs = q.toString();
  return `/api/v1/inbox/media/${encodeURIComponent(messageId)}${qs ? `?${qs}` : ""}`;
}

export default function MessageMedia({
  messageId,
  media,
  out,
  onOpenImage,
  interactive = true,
}: {
  messageId: string;
  media: MediaMeta;
  out: boolean;
  onOpenImage: (messageId: string, media: MediaMeta) => void;
  interactive?: boolean; // false en modo selección: un toque selecciona, no abre
}) {
  const [broken, setBroken] = useState(false);
  const available = media.hasFile && !broken;

  if (!available && media.pending && !broken) {
    return (
      <span className={clsx("mb-1 flex items-center gap-2 rounded-lg px-2.5 py-2 text-xs", out ? "bg-white/15" : "bg-slate-100 text-slate-600")}>
        <Loader2 size={14} className="animate-spin" /> Recibiendo {KIND_TEXT[media.kind].toLowerCase()}…
      </span>
    );
  }

  if (!available) {
    return (
      <span className={clsx("mb-1 flex items-start gap-2 rounded-lg px-2.5 py-2 text-xs", out ? "bg-white/15" : "bg-slate-100 text-slate-600")}>
        <ImageOff size={15} className="mt-0.5 shrink-0 opacity-70" />
        <span>
          <span className="font-semibold">{KIND_TEXT[media.kind]} no disponible en el CRM</span>
          <span className="block opacity-80">Ábrelo en el móvil{media.filename ? ` (${media.filename})` : ""}.</span>
        </span>
      </span>
    );
  }

  if (media.kind === "image" || media.kind === "sticker") {
    return (
      <button
        type="button"
        tabIndex={interactive ? 0 : -1}
        onClick={(e) => {
          if (!interactive) return;
          e.stopPropagation();
          onOpenImage(messageId, media);
        }}
        className={clsx("mb-1 block overflow-hidden rounded-xl", media.kind === "sticker" ? "bg-transparent" : "bg-slate-200/60")}
        aria-label={`Ver ${KIND_TEXT[media.kind].toLowerCase()}`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={mediaUrl(messageId, { thumb: media.hasThumb })}
          alt={media.caption || KIND_TEXT[media.kind]}
          loading="lazy"
          draggable={false}
          onError={() => setBroken(true)}
          className={clsx("block object-cover", media.kind === "sticker" ? "h-28 w-28 object-contain" : "max-h-72 w-full min-w-[12rem] max-w-[17rem]")}
        />
      </button>
    );
  }

  if (media.kind === "video") {
    return (
      <span className="mb-1 block overflow-hidden rounded-xl bg-black">
        <video
          src={mediaUrl(messageId)}
          controls={interactive}
          preload="metadata"
          playsInline
          className="block max-h-72 w-full min-w-[12rem] max-w-[17rem]"
          onError={() => setBroken(true)}
        >
          <Video size={16} />
        </video>
      </span>
    );
  }

  if (media.kind === "voice" || media.kind === "audio") {
    return (
      <span className="mb-1 flex w-[15.5rem] max-w-full items-center gap-2">
        <span className={clsx("flex h-8 w-8 shrink-0 items-center justify-center rounded-full", out ? "bg-white/20" : "bg-emerald-100 text-emerald-700")}>
          <Mic size={15} />
        </span>
        {/* El reproductor nativo es el más fiable en iOS/Android */}
        <audio
          src={mediaUrl(messageId)}
          controls
          preload="none"
          className={clsx("h-9 min-w-0 flex-1", !interactive && "pointer-events-none")}
          onError={() => setBroken(true)}
        />
      </span>
    );
  }

  return (
    <a
      href={interactive ? mediaUrl(messageId, { download: !/pdf|image|video|audio/.test(media.mimetype) }) : undefined}
      target="_blank"
      rel="noopener"
      onClick={(e) => {
        if (!interactive) e.preventDefault();
        e.stopPropagation();
      }}
      className={clsx(
        "mb-1 flex min-w-[12rem] max-w-[17rem] items-center gap-2.5 rounded-xl px-3 py-2.5 no-underline",
        out ? "bg-white/15 text-white" : "bg-slate-100 text-slate-800"
      )}
    >
      <FileText size={22} className="shrink-0 opacity-80" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{media.filename || "Documento"}</span>
        <span className="block text-[11px] opacity-70">{[sizeText(media.size), media.mimetype.split(";")[0].split("/")[1]?.toUpperCase()].filter(Boolean).join(" · ")}</span>
      </span>
      <Download size={16} className="shrink-0 opacity-70" />
    </a>
  );
}

// Visor de fotos a pantalla completa (pellizcar para ampliar lo hace el navegador).
export function Lightbox({ messageId, media, onClose }: { messageId: string; media: MediaMeta; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[70] flex flex-col bg-black/95" role="dialog" aria-modal="true" aria-label="Foto">
      <div className="flex items-center justify-between gap-2 px-3 pb-2 pt-[max(0.75rem,env(safe-area-inset-top))] text-white">
        <span className="min-w-0 truncate text-sm">{media.caption || KIND_TEXT[media.kind]}</span>
        <span className="flex shrink-0 items-center gap-1">
          <a href={mediaUrl(messageId, { download: true })} className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-white/10" aria-label="Descargar">
            <Download size={20} />
          </a>
          <button onClick={onClose} className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-white/10" aria-label="Cerrar">
            <X size={22} />
          </button>
        </span>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]" onClick={onClose}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={mediaUrl(messageId)} alt={media.caption || "Foto"} className="max-h-full max-w-full object-contain" onClick={(e) => e.stopPropagation()} />
      </div>
    </div>
  );
}
