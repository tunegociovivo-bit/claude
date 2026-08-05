"use client";

import { useCallback, useEffect, useState } from "react";

// Logo del negocio: PNG/JPG/WebP de hasta 500KB. Se guarda en BD como data
// URL (el disco de Railway es efímero) y lo pinta el menú lateral.
export default function LogoCard() {
  const [logo, setLogo] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const res = await fetch("/api/v1/settings/logo", { cache: "no-store" });
    const data = await res.json().catch(() => null);
    if (res.ok) setLogo(data.logoDataUrl ?? null);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function upload(file: File) {
    setBusy(true);
    setError("");
    try {
      if (file.size > 500 * 1024) throw new Error("El logo debe ocupar como máximo 500KB");
      const body = new FormData();
      body.append("logo", file);
      const res = await fetch("/api/v1/settings/logo", { method: "POST", body });
      if (res.status === 401 || res.status === 403) {
        setForbidden(true);
        return;
      }
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "No se pudo guardar el logo");
      setLogo(data.logoDataUrl);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo guardar el logo");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setError("");
    const res = await fetch("/api/v1/settings/logo", { method: "DELETE" });
    if (res.ok) setLogo(null);
    else setError("No se pudo quitar el logo");
    setBusy(false);
  }

  if (forbidden) return null;

  return (
    <section className="card space-y-4 p-6">
      <div>
        <h2 className="font-semibold">Logo del negocio</h2>
        <p className="text-xs text-slate-500">
          Aparece en el menú lateral. PNG, JPG o WebP de hasta 500KB.
        </p>
      </div>
      <div className="flex items-center gap-4">
        {logo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logo} alt="Logo del negocio" className="h-14 w-14 rounded-xl object-cover" />
        ) : (
          <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-brand-500 text-xl font-bold text-white">
            P
          </div>
        )}
        <div className="space-x-2">
          <label className="btn-primary inline-flex cursor-pointer">
            {busy ? "Un momento…" : logo ? "Cambiar logo" : "Subir logo"}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              disabled={busy}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) void upload(file);
              }}
            />
          </label>
          {logo && (
            <button type="button" className="btn-ghost" disabled={busy} onClick={remove}>
              Quitar
            </button>
          )}
        </div>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </section>
  );
}
