"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Paperclip, X, Loader2, Upload, FileText, Image as ImageIcon, File as FileIcon } from "lucide-react";

type AttachmentTarget = "TASK" | "DOCUMENT" | "CLIENT" | "PROJECT";

type Attachment = {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  s3Key: string;
  url: string | null;
  // true cuando el adjunto NO está en nuestro storage sino en un
  // servicio externo (Google Drive, Dropbox…). Importado de Asana
  // pero sin posibilidad de descargar el binario.
  isExternal?: boolean;
  createdAt: string;
};

const MAX_FILE_BYTES = 50 * 1024 * 1024; // 50 MB

export default function AttachmentList({
  targetType,
  targetId,
  readOnly = false
}: {
  targetType: AttachmentTarget;
  targetId: string;
  readOnly?: boolean;
}) {
  const [items, setItems] = useState<Attachment[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState<{ name: string; progress: number }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [disabled, setDisabled] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/v1/files?targetType=${targetType}&targetId=${targetId}`);
      if (r.ok) setItems((await r.json()).items ?? []);
    } catch (e: any) {
      setError(e.message);
    }
    setLoading(false);
  }, [targetType, targetId]);

  useEffect(() => {
    if (targetId) load();
  }, [targetId, load]);

  // Listener para eventos externos que invaliden la lista — p.ej.
  // cuando el botón "Re-importar de Asana" del modal de tarea
  // sube nuevos attachments al task. Sin esto el user tenía que
  // cerrar y reabrir el modal para verlos.
  useEffect(() => {
    function onExternalChange(e: Event) {
      const detail = (e as CustomEvent).detail;
      if (!detail) return;
      if (detail.targetType === targetType && detail.targetId === targetId) {
        load();
      }
    }
    window.addEventListener("attachments-changed", onExternalChange);
    return () => window.removeEventListener("attachments-changed", onExternalChange);
  }, [targetType, targetId, load]);

  async function uploadFile(file: File) {
    if (file.size > MAX_FILE_BYTES) {
      setError(`"${file.name}" excede 50 MB`);
      return;
    }
    setError(null);
    setUploading((prev) => [...prev, { name: file.name, progress: 0 }]);

    try {
      // Subida vía proxy del servidor — multipart POST en lugar de
      // signed URL + PUT directo a R2. Evita configurar CORS en el
      // bucket y unifica el error handling. El server-side sube con
      // sus credenciales y devuelve la fila File ya creada.
      const form = new FormData();
      form.append("file", file, file.name);
      form.append("targetType", targetType);
      form.append("targetId", targetId);

      const created = await new Promise<any>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", "/api/v1/files/upload");
        xhr.upload.onprogress = (e) => {
          if (!e.lengthComputable) return;
          const pct = (e.loaded / e.total) * 100;
          setUploading((prev) =>
            prev.map((u) => (u.name === file.name ? { ...u, progress: pct } : u))
          );
        };
        xhr.onload = () => {
          if (xhr.status === 503) {
            setDisabled(true);
            reject(new Error("Storage no configurado"));
            return;
          }
          if (xhr.status >= 200 && xhr.status < 300) {
            try {
              resolve(JSON.parse(xhr.responseText));
            } catch {
              reject(new Error("Respuesta inválida"));
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

      setItems((prev) => [created, ...prev]);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setUploading((prev) => prev.filter((u) => u.name !== file.name));
    }
  }

  async function handleFiles(files: FileList | null) {
    if (!files) return;
    for (const f of Array.from(files)) await uploadFile(f);
  }

  async function deleteAttachment(id: string) {
    if (!confirm("¿Borrar este adjunto?")) return;
    const r = await fetch(`/api/v1/files/${id}`, { method: "DELETE" });
    if (r.ok) setItems((prev) => prev.filter((a) => a.id !== id));
    else alert("No se pudo borrar");
  }

  return (
    <div>
      <div className="text-xs font-medium text-slate-700 mb-2 flex items-center gap-1.5">
        <Paperclip className="h-3.5 w-3.5" />
        Adjuntos
        <span className="text-slate-400">({items.length})</span>
      </div>

      {!readOnly && (
        <>
          <input
            type="file"
            multiple
            ref={fileInputRef}
            className="hidden"
            onChange={(e) => {
              handleFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setIsDragging(false);
              handleFiles(e.dataTransfer.files);
            }}
            onClick={() => fileInputRef.current?.click()}
            className={
              "rounded-lg border-2 border-dashed cursor-pointer transition px-3 py-4 text-center " +
              (isDragging
                ? "border-brand-500 bg-brand-50"
                : "border-slate-200 hover:border-brand-300 hover:bg-slate-50")
            }
          >
            <Upload className="h-4 w-4 inline mr-1.5 text-slate-400" />
            <span className="text-xs text-slate-600">
              Arrastra archivos aquí o <span className="text-brand-600 font-medium">haz clic para subir</span>
            </span>
            <div className="text-[10px] text-slate-400 mt-0.5">Máx. 50 MB por archivo</div>
          </div>
        </>
      )}

      {disabled && (
        <div className="mt-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2.5 py-1.5">
          Storage de archivos no configurado. Pide al admin que añada las variables{" "}
          <code>STORAGE_*</code> al servicio (Cloudflare R2 recomendado).
        </div>
      )}

      {error && (
        <div className="mt-2 text-xs text-rose-600 bg-rose-50 border border-rose-200 rounded-md px-2.5 py-1.5">
          {error}
        </div>
      )}

      <div className="mt-3 space-y-1.5">
        {uploading.map((u) => (
          <div key={u.name} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-50 border">
            <Loader2 className="h-4 w-4 animate-spin text-brand-500" />
            <span className="text-sm truncate flex-1">{u.name}</span>
            <span className="text-xs text-slate-500">{Math.round(u.progress)}%</span>
          </div>
        ))}

        {loading ? (
          <div className="text-xs text-slate-400 italic">Cargando…</div>
        ) : (
          items.map((a) => <AttachmentRow key={a.id} attachment={a} onDelete={!readOnly ? deleteAttachment : undefined} />)
        )}
      </div>
    </div>
  );
}

function AttachmentRow({
  attachment,
  onDelete
}: {
  attachment: Attachment;
  onDelete?: (id: string) => void;
}) {
  const isImage = attachment.mimeType.startsWith("image/");
  const isPdf = attachment.mimeType === "application/pdf";
  const sizeKb = attachment.sizeBytes / 1024;
  const sizeStr = sizeKb < 1024 ? `${Math.round(sizeKb)} KB` : `${(sizeKb / 1024).toFixed(1)} MB`;

  const Icon = isImage ? ImageIcon : isPdf ? FileText : FileIcon;

  return (
    <div className="flex items-center gap-2.5 group bg-white border rounded-lg p-2 hover:border-brand-200">
      {isImage && attachment.url ? (
        <a href={attachment.url} target="_blank" rel="noreferrer">
          <img
            src={attachment.url}
            alt={attachment.name}
            className="h-10 w-10 rounded object-cover bg-slate-100"
          />
        </a>
      ) : (
        <div className="h-10 w-10 rounded bg-slate-50 grid place-items-center text-slate-400">
          <Icon className="h-4 w-4" />
        </div>
      )}
      <div className="flex-1 min-w-0">
        {attachment.url ? (
          <a
            href={attachment.url}
            target="_blank"
            rel="noreferrer"
            className="text-sm font-medium text-slate-900 hover:text-brand-600 truncate block"
          >
            {attachment.name}
            {attachment.isExternal && (
              <span className="ml-1.5 text-[10px] uppercase tracking-wide px-1 py-0.5 rounded bg-sky-100 text-sky-700 border border-sky-200 align-middle">
                externo
              </span>
            )}
          </a>
        ) : (
          <span className="text-sm font-medium text-slate-500 italic">{attachment.name}</span>
        )}
        <div className="text-[11px] text-slate-500">
          {attachment.isExternal ? (
            <>Archivo en servicio externo (Drive/Dropbox/…) — abre en pestaña nueva</>
          ) : (
            sizeStr
          )}
        </div>
      </div>
      {onDelete && (
        <button
          type="button"
          onClick={() => onDelete(attachment.id)}
          className="opacity-0 group-hover:opacity-100 h-7 w-7 grid place-items-center rounded text-slate-400 hover:text-rose-600 hover:bg-rose-50"
          title="Borrar"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
