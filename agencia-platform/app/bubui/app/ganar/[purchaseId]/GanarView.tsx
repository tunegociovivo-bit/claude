"use client";

import { useEffect, useState } from "react";
import { customerAuthHeaders } from "@/app/bubui/lib/customerAuth";

type Action = { key: "share" | "review" | "follow" | "photo"; label: string; pct: number; done: boolean; blocked: boolean };
type Data = {
  business: { id: string; name: string; googlePlaceId?: string | null; instagramUrl?: string | null; facebookUrl?: string | null; reviewUrl?: string | null };
  actions: Action[];
};

const META: Record<Action["key"], { icon: string; cta: string }> = {
  share: { icon: "🚀", cta: "Compartir por WhatsApp" },
  review: { icon: "⭐", cta: "Abrir Google y reseñar" },
  follow: { icon: "📷", cta: "Abrir su perfil" },
  photo: { icon: "🤳", cta: "Subir foto/historia" }
};

export default function GanarView({ purchaseId }: { purchaseId: string }) {
  const [data, setData] = useState<Data | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ key: string; text: string; ok: boolean } | null>(null);

  async function load() {
    try {
      const r = await fetch(`/api/bubui/post-purchase/${purchaseId}/action`, { headers: customerAuthHeaders() });
      if (!r.ok) {
        setLoadErr(r.status === 401 ? "Entra en tu cuenta de Bubui para reclamar el descuento." : "No hemos encontrado esta oferta.");
        return;
      }
      setData(await r.json());
    } catch {
      setLoadErr("Sin conexión. Inténtalo de nuevo.");
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function submit(action: Action["key"], file?: File) {
    setBusy(action);
    setMsg(null);
    try {
      const fd = new FormData();
      fd.set("action", action);
      if (file) fd.set("file", file);
      const r = await fetch(`/api/bubui/post-purchase/${purchaseId}/action`, { method: "POST", headers: customerAuthHeaders(), body: fd });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setMsg({ key: action, text: d?.error?.message ?? "No se pudo registrar.", ok: false });
      } else if (d.valid === false) {
        setMsg({ key: action, text: d.reason ?? "No hemos podido validar la captura. Inténtalo otra vez.", ok: false });
      } else {
        setMsg({ key: action, text: d.reason ?? `¡Cupón del ${d.discountPct}% activado!`, ok: true });
        await load();
      }
    } finally {
      setBusy(null);
    }
  }

  function shareWhatsApp() {
    const text = `Te recomiendo Bubui: descuentos en negocios de mi zona. Descárgala 👉 ${window.location.origin}/bubui/app`;
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank");
  }

  if (loadErr) {
    return (
      <main className="max-w-md mx-auto px-4 py-12 text-center">
        <p className="text-sm text-black/60">{loadErr}</p>
        <a href="/bubui/app" className="text-pink-600 text-sm hover:underline mt-3 inline-block">Ir a Bubui</a>
      </main>
    );
  }
  if (!data) return <main className="min-h-screen grid place-items-center text-sm text-black/50">Cargando…</main>;

  const b = data.business;
  return (
    <main className="max-w-md mx-auto px-4 py-8 pb-24">
      <div className="text-center mb-5">
        <div className="text-4xl mb-1">🎁</div>
        <h1 className="text-xl font-black">Gana descuento en {b.name}</h1>
        <p className="text-sm text-black/55 mt-1">Haz una de estas acciones y consíguelo para tu próxima visita.</p>
      </div>

      <div className="space-y-3">
        {data.actions.length === 0 && <p className="text-sm text-black/55 text-center">Este negocio no tiene acciones activas ahora mismo.</p>}
        {data.actions.map((a) => {
          const meta = META[a.key];
          const link = a.key === "review" ? b.reviewUrl : a.key === "follow" ? b.instagramUrl || b.facebookUrl : null;
          const showMsg = msg && msg.key === a.key;
          return (
            <section key={a.key} className={`bubui-card p-4 ${a.done ? "opacity-70" : ""}`}>
              <div className="flex items-center justify-between gap-2">
                <div className="font-bold text-sm">{meta.icon} {a.label}</div>
                <span className="text-pink-600 font-black text-sm shrink-0">{a.pct}%</span>
              </div>

              {a.done ? (
                <p className="text-xs text-emerald-700 mt-2">✓ Ya conseguido — lo verás en tus cupones.</p>
              ) : a.blocked ? (
                <p className="text-xs text-black/45 mt-2">
                  {a.key === "follow" ? "Ya sigues a este negocio. ¡Gracias! Prueba otra acción." : "Ya dejaste una reseña de este negocio. ¡Gracias! Prueba otra acción."}
                </p>
              ) : (
                <div className="mt-2 space-y-2">
                  {a.key === "share" ? (
                    <>
                      <button onClick={shareWhatsApp} className="bubui-btn w-full py-2 text-xs">{meta.cta}</button>
                      <button onClick={() => submit("share")} disabled={busy === a.key} className="w-full py-2 text-xs rounded-lg border bg-white disabled:opacity-50">
                        {busy === a.key ? "Activando…" : "Ya lo compartí → activar cupón"}
                      </button>
                    </>
                  ) : (
                    <>
                      {link && (
                        <a href={link} target="_blank" rel="noreferrer" className="bubui-btn w-full py-2 text-xs block text-center">{meta.cta}</a>
                      )}
                      <label className={`w-full py-2 text-xs rounded-lg border bg-white flex items-center justify-center cursor-pointer ${busy === a.key ? "opacity-50" : ""}`}>
                        {busy === a.key ? "Verificando…" : "Subir captura para verificar"}
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          disabled={busy === a.key}
                          onChange={(e) => { const f = e.target.files?.[0]; if (f) submit(a.key, f); e.target.value = ""; }}
                        />
                      </label>
                    </>
                  )}
                </div>
              )}
              {showMsg && <p className={`text-xs mt-2 ${msg!.ok ? "text-emerald-700" : "text-rose-600"}`}>{msg!.text}</p>}
            </section>
          );
        })}
      </div>

      <a href="/bubui/app" className="block text-center text-sm text-pink-600 hover:underline mt-6">← Volver a Bubui</a>
    </main>
  );
}
