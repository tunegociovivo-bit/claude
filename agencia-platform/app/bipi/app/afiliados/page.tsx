"use client";

/**
 * Pestaña Afiliados — invita amigos, gana recompensas por hitos (1/3/5).
 * Las recompensas las pone tu negocio de origen.
 */

import { useEffect, useState } from "react";

type Milestone = { n: number; reward: string; unlocked: boolean };
type RefData = {
  code: string;
  verifiedReferrals: number;
  originBusiness: string | null;
  referralEnabled: boolean;
  milestones: Milestone[];
  nextMilestone: number | null;
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
        const raw = localStorage.getItem("bipi.customer");
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
      document.body.classList.add("bipi-embedded");
    }
    if (!id) { setNoSession(true); setLoading(false); return; }
    (async () => {
      try {
        const r = await fetch(`/api/bipi/customer/${id}/referral`);
        if (r.ok) {
          const d: RefData = await r.json();
          setData(d);
          setLink(`${window.location.origin}/bipi/r/${d.code}`);
        }
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  function shareWhatsApp() {
    const text = `¡Únete a Bipi y llévate descuentos en negocios del barrio! 🎁 ${link}`;
    window.location.href = `https://wa.me/?text=${encodeURIComponent(text)}`;
  }
  async function copy() {
    try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch {}
  }

  if (noSession) {
    return (
      <main className="max-w-md mx-auto px-4 py-16 text-center">
        <h1 className="text-xl font-black">Inicia sesión para invitar</h1>
        <a href="/bipi/app" className="bipi-btn inline-flex mt-4">Ir a Bipi</a>
      </main>
    );
  }

  const count = data?.verifiedReferrals ?? 0;
  const goal = data?.nextMilestone ?? 5;
  const pct = Math.min(100, Math.round((count / 5) * 100));

  return (
    <main className="max-w-md mx-auto px-4 py-6 pb-24">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/bipi/banner-amigo.png" alt="Invita y ganáis los dos" className="w-full rounded-2xl mb-4 bipi-fade-up" />

      {loading ? (
        <div className="space-y-3">
          <div className="bipi-skeleton h-28" />
          <div className="bipi-skeleton h-40" />
        </div>
      ) : (
        <>
          {/* Progreso */}
          <div className="bipi-card p-5 mb-4 bipi-fade-up bipi-fade-up-1">
            <div className="flex items-end justify-between mb-2">
              <div>
                <div className="text-[10px] uppercase tracking-wider text-black/45 font-bold">Amigos verificados</div>
                <div className="bipi-discount-big">{count}</div>
              </div>
              {goal && <div className="text-xs text-black/55 font-semibold">{count}/{goal} para el siguiente premio</div>}
            </div>
            <div className="h-2.5 rounded-full bg-pink-100 overflow-hidden">
              <div className="h-full rounded-full" style={{ width: `${pct}%`, background: "linear-gradient(90deg,#EC4899,#DB2777)" }} />
            </div>
          </div>

          {/* Hitos */}
          <div className="space-y-2 mb-5">
            {(data?.milestones ?? []).map((m) => (
              <div key={m.n} className={"bipi-card p-4 flex items-center gap-3 " + (m.unlocked ? "ring-2 ring-pink-400" : "opacity-90")}>
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
          <button onClick={shareWhatsApp} className="bipi-btn bipi-attention w-full py-4 text-base">
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
        <nav className="bipi-bottom-nav">
          <a href="/bipi/app"><span style={{ fontSize: 18 }}>🏠</span><span>Inicio</span></a>
          <a href="/bipi/app/descubre"><span style={{ fontSize: 18 }}>🧭</span><span>Descubre</span></a>
          <a href="/bipi/app/afiliados" className="active"><span style={{ fontSize: 18 }}>🎁</span><span>Afiliados</span></a>
          <a href="/bipi/app/mapa"><span style={{ fontSize: 18 }}>🗺</span><span>Mapa</span></a>
        </nav>
      )}
    </main>
  );
}
