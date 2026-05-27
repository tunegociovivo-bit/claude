"use client";

import { useRef, useState } from "react";
import { Upload, Loader2, X } from "lucide-react";

/**
 * Componente reutilizable de subida de imagen.
 * - Si Cloudflare R2 está configurado en el servidor, sube vía presigned URL
 *   y devuelve la URL pública/firmada por onChange.
 * - Si no está configurado, permite pegar una URL manualmente.
 *
 * targetType/targetId se pasan al endpoint /api/v1/files/upload-url para que
 * la key del objeto esté namespaced (ej. logos de workspace, fotos de user).
 */
export default function ImageUpload({
  value,
  onChange,
  targetType,
  targetId,
  size = 80,
  shape = "circle",
  label
}: {
  value: string;
  onChange: (url: string) => void;
  targetType: "USER" | "WORKSPACE" | "PROJECT" | "CLIENT";
  targetId: string;
  size?: number;
  shape?: "circle" | "square";
  label?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"upload" | "url">("upload");

  async function handleFile(file: File) {
    if (file.size > 5 * 1024 * 1024) {
      setError("La imagen excede 5 MB.");
      return;
    }
    setError(null);
    setUploading(true);
    try {
      const urlRes = await fetch("/api/v1/files/upload-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: file.name,
          contentType: file.type || "image/jpeg",
          sizeBytes: file.size,
          targetType,
          targetId
        })
      });
      if (urlRes.status === 503) {
        setMode("url");
        setError("Storage no configurado. Pega una URL pública.");
        setUploading(false);
        return;
      }
      if (!urlRes.ok) throw new Error("No se pudo iniciar la subida");
      const { uploadUrl, s3Key } = await urlRes.json();

      const putRes = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type || "image/jpeg" },
        body: file
      });
      if (!putRes.ok) throw new Error("Subida falló");

      // Registrar metadata para tener URL firmada/pública
      const metaRes = await fetch("/api/v1/files", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: file.name,
          mimeType: file.type || "image/jpeg",
          sizeBytes: file.size,
          s3Key,
          targetType,
          targetId
        })
      });
      if (!metaRes.ok) throw new Error("No se pudo guardar la metadata");
      const created = await metaRes.json();
      if (created.url) onChange(created.url);
    } catch (e: any) {
      setError(e.message ?? String(e));
    } finally {
      setUploading(false);
    }
  }

  return (
    <div>
      {label && (
        <label className="block text-xs font-medium text-slate-700 mb-1">{label}</label>
      )}
      <div className="flex items-center gap-3">
        <div
          className={
            "shrink-0 bg-slate-100 border border-slate-200 overflow-hidden grid place-items-center text-slate-400 " +
            (shape === "circle" ? "rounded-full" : "rounded-lg")
          }
          style={{ width: size, height: size }}
        >
          {value ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={value} alt="preview" className="h-full w-full object-cover" />
          ) : uploading ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : (
            <Upload className="h-5 w-5" />
          )}
        </div>
        <div className="flex-1">
          {mode === "upload" ? (
            <>
              <input
                type="file"
                accept="image/*"
                ref={inputRef}
                className="hidden"
                onChange={(e) => {
                  if (e.target.files?.[0]) handleFile(e.target.files[0]);
                  e.target.value = "";
                }}
              />
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                disabled={uploading}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border text-sm hover:bg-slate-50 disabled:opacity-50"
              >
                {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                {value ? "Cambiar" : "Subir"}
              </button>
              {value && (
                <button
                  type="button"
                  onClick={() => onChange("")}
                  className="ml-1 inline-flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs text-rose-600 hover:bg-rose-50"
                >
                  <X className="h-3.5 w-3.5" />
                  Quitar
                </button>
              )}
              <p className="text-[11px] text-slate-500 mt-1">
                JPG/PNG/WebP. Max 5 MB.{" "}
                <button type="button" onClick={() => setMode("url")} className="underline">
                  o pega URL
                </button>
              </p>
            </>
          ) : (
            <>
              <input
                type="url"
                value={value}
                onChange={(e) => onChange(e.target.value)}
                placeholder="https://…/foto.jpg"
                className="w-full px-3 py-1.5 rounded-lg border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
              <p className="text-[11px] text-slate-500 mt-1">
                <button type="button" onClick={() => setMode("upload")} className="underline">
                  o sube archivo
                </button>
              </p>
            </>
          )}
          {error && <p className="text-xs text-rose-600 mt-1">{error}</p>}
        </div>
      </div>
    </div>
  );
}
