"use client";

/**
 * Pestaña Afiliados — invita amigos, gana recompensas por hitos (1/3/5).
 * Las recompensas las pone tu negocio de origen.
 */

import { useEffect, useState } from "react";
import { customerAuthHeaders } from "@/app/bubui/lib/customerAuth";

type Milestone = { n: number; reward: string; unlocked: boolean };
type Friend = { initial: string; verified: boolean; joinedAt: string };
type RefData = {
  code: string;
  verifiedReferrals: number;
  originBusiness: string | null;
  referralEnabled: boolean;
  milestones: Milestone[];
  nextMilestone: number | null;
  friends?: Friend[];
};

export default function AfiliadosPage() {
  const [data, setData] = useState<RefData | null>(null);
  const [loading, setLoading] = useState(true);
  const [link, setLink] = useState("");
  const [copied, setCopied] = useState(false);
  const [noSession, setNoSession] = useState(false);
  const [embedded, setEmbedded] = useState(false);

  useEffect(() => {
    let id = "";
    let fromApp = false;
    try {
      // cid en URL (cuando se abre embebido desde la app nativa) o sesión local.
      const cid = new URLSearchParams(window.location.search).get("cid") || "";
      if (cid) id = cid;
      if (!id) {
        const raw = localStorage.getItem("bubui.customer");
        if (raw) id = JSON.parse(raw).customerId;
      }
      // Embebido = dentro de la WebView nativa (react-native-webview inyecta
      // window.ReactNativeWebView) o abierto con ?cid= desde la app.
      fromApp = Boolean((window as any).ReactNativeWebView) || Boolean(cid);
    } catch {}
    // Embebido en la app nativa: ocultamos cabecera/footer/nav web para no
    // duplicar la barra inferior nativa.
    if (fromApp) {
      setEmbedded(true);
      document.body.classList.add("bubui-embedded");
    }
    if (!id) { setNoSession(true); setLoading(false); return; }
    (async () => {
      try {
        const r = await fetch(`/api/bubui/customer/${id}/referral`, { headers: customerAuthHeaders() });
        if (r.ok) {
          const d: RefData = await r.json();
          setData(d);
          setLink(`${window.location.origin}/bubui/r/${d.code}`);
        }
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  function shareWhatsApp() {
    const text = `¡Únete a Bubui y llévate descuentos en negocios del barrio! 🎁 ${link}`;
    window.location.href = `https://wa.me/?text=${encodeURIComponent(text)}`;
  }
  async function copy() {
    try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch {}
  }

  if (noSession) {
    return (
      <main className="max-w-md mx-auto px-4 py-16 text-center">
        <h1 className="text-xl font-black">Inicia sesión para invitar</h1>
        <a href="/bubui/app" className="bubui-btn inline-flex mt-4">Ir a Bubui</a>
      </main>
    );
  }

  const count = data?.verifiedReferrals ?? 0;
  const goal = data?.nextMilestone ?? 5;
  const pct = Math.min(100, Math.round((count / 5) * 100));

  return (
    <main className="max-w-md mx-auto px-4 py-6 pb-24">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/bubui/banner-amigo.png" alt="Invita y ganáis los dos" className="w-full rounded-2xl mb-4 bubui-fade-up" />

      {loading ? (
        <div className="space-y-3">
          <div className="bubui-skeleton h-28" />
          <div className="bubui-skeleton h-40" />
        </div>
      ) : (
        <>
          {/* Progreso */}
          <div className="bubui-card p-5 mb-4 bubui-fade-up bubui-fade-up-1">
            <div className="flex items-end justify-between mb-2">
              <div>
                <div className="text-[10px] uppercase tracking-wider text-black/45 font-bold">Amigos verificados</div>
                <div className="bubui-discount-big">{count}</div>
              </div>
              {goal && <div className="text-xs text-black/55 font-semibold">{count}/{goal} para el siguiente premio</div>}
            </div>
            <div className="h-2.5 rounded-full bg-pink-100 overflow-hidden">
              <div className="h-full rounded-full" style={{ width: `${pct}%`, background: "linear-gradient(90deg,#EC4899,#DB2777)" }} />
            </div>

            {/* 5 slots visuales — uno por amigo. Se marcan a medida que tus
                amigos se dan de alta. Cuando los 5 están en verde, se
                desbloquea el cupón grande automáticamente. */}
            <div className="flex justify-between gap-1 mt-4">
              {Array.from({ length: 5 }).map((_, i) => {
                const f = data?.friends?.[i];
                const filledVerified = !!f && f.verified;
                const filledPending = !!f && !f.verified;
                return (
                  <div key={i} className="flex-1 flex flex-col items-center gap-1">
                    <div
                      className={
                        "h-11 w-11 rounded-full grid place-items-center text-sm font-black border-2 transition-all " +
                        (filledVerified
                          ? "bg-pink-500 text-white border-pink-500"
                          : filledPending
                            ? "bg-amber-50 text-amber-700 border-amber-300"
                            : "bg-white text-black/25 border-dashed border-black/15")
                      }
                      title={
                        filledVerified
                          ? "Amigo verificado"
                          : filledPending
                            ? "Pendiente de verificar su teléfono"
                            : "Slot libre"
                      }
                    >
                      {filledVerified ? "✓" : filledPending ? "…" : i + 1}
                    </div>
                    <div className="text-[10px] text-black/45 font-semibold">
                      {f ? f.initial : "—"}
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="text-[11px] text-black/45 mt-2 text-center">
              Cada vez que un amigo se da de alta verás su check aquí. Al llenar los 5, ¡el cupón grande es tuyo!
            </p>
          </div>

          {/* Hitos */}
          <div className="space-y-2 mb-5">
            {(data?.milestones ?? []).map((m) => (
              <div key={m.n} className={"bubui-card p-4 flex items-center gap-3 " + (m.unlocked ? "ring-2 ring-pink-400" : "opacity-90")}>
                <div className={"h-10 w-10 rounded-full grid place-items-center font-black text-white shrink-0 " + (m.unlocked ? "bg-pink-500" : "bg-black/25")}>
                  {m.unlocked ? "✓" : m.n}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-bold text-sm">{m.n} {m.n === 1 ? "amigo" : "amigos"} → {m.reward}</div>
                  <div className="text-xs text-black/50">{m.unlocked ? "¡Desbloqueado! Cupón en tus cupones." : "Bloqueado"}</div>
                </div>
              </div>
            ))}
          </div>

          {/* Compartir */}
          <button onClick={shareWhatsApp} className="bubui-btn bubui-attention w-full py-4 text-base">
            📲 Invitar amigos por WhatsApp
          </button>
          <div className="flex items-center gap-2 mt-3 px-3 py-2 rounded-lg border border-black/10 bg-pink-50/40">
            <span className="text-xs text-black/70 font-mono truncate flex-1">{link}</span>
            <button onClick={copy} className="px-3 py-1 rounded-full bg-black text-white text-xs font-bold hover:bg-pink-600 transition">
              {copied ? "✓ Copiado" : "Copiar"}
            </button>
          </div>
          <p className="text-[11px] text-black/45 mt-2 text-center">
            Se abrirá WhatsApp con el mensaje listo — solo elige a tus amigos. O copia el enlace para enviarlo por donde quieras.
          </p>
        </>
      )}

      {!embedded && (
        <nav className="bubui-bottom-nav">
          <a href="/bubui/app"><span style={{ fontSize: 18 }}>🏠</span><span>Inicio</span></a>
          <a href="/bubui/app/descubre"><span style={{ fontSize: 18 }}>🧭</span><span>Descubre</span></a>
          <a href="/bubui/app/afiliados" className="active"><span style={{ fontSize: 18 }}>🎁</span><span>Afiliados</span></a>
          <a href="/bubui/app/mapa"><span style={{ fontSize: 18 }}>🗺</span><span>Mapa</span></a>
        </nav>
      )}
    </main>
  );
}
