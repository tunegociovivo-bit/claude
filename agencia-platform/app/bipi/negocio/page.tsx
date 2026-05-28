"use client";

/**
 * Panel del negocio Bipi. Vive en /bipi/negocio.
 *
 * Si no hay sesión guardada (localStorage `bipi.business`), muestra el
 * login. Si la hay, muestra el dashboard con compras pendientes a
 * confirmar y métricas básicas.
 */

import { useEffect, useState } from "react";

type Session = { businessId: string; name: string; token: string };

export default function NegocioPanel() {
  const [session, setSession] = useState<Session | null>(null);
  useEffect(() => {
    try {
      const raw = localStorage.getItem("bipi.business");
      if (raw) setSession(JSON.parse(raw));
    } catch {}
  }, []);

  if (!session) {
    return <LoginForm onLogin={(s) => { setSession(s); localStorage.setItem("bipi.business", JSON.stringify(s)); }} />;
  }
  return (
    <Dashboard
      session={session}
      onLogout={() => { setSession(null); localStorage.removeItem("bipi.business"); }}
    />
  );
}

function LoginForm({ onLogin }: { onLogin: (s: Session) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/bipi/business/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password })
      });
      const j = await r.json();
      if (!r.ok) {
        setError(j?.error?.message ?? `Error ${r.status}`);
        return;
      }
      onLogin({ businessId: j.businessId, name: j.name, token: j.token });
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="max-w-md mx-auto px-4 py-12">
      <div className="text-center mb-6 bipi-fade-up">
        <h1 className="bipi-wordmark mx-auto justify-center" style={{ fontSize: 56 }}>bipi</h1>
        <p className="text-black/60 text-sm mt-3">Panel del negocio</p>
      </div>
      <form onSubmit={submit} className="space-y-3 bipi-card p-6 bipi-fade-up bipi-fade-up-1">
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          className="bipi-input"
        />
        <input
          type="password"
          placeholder="Contraseña"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          className="bipi-input"
        />
        {error && <p className="text-rose-700 text-sm">{error}</p>}
        <button type="submit" disabled={busy} className="bipi-btn w-full">
          {busy ? "Entrando…" : "Entrar"}
        </button>
        <p className="text-xs text-black/55 text-center">
          ¿Aún no tienes cuenta? <a href="/bipi/registro" className="text-pink-600 font-semibold hover:underline">Crea tu negocio</a>
        </p>
      </form>
    </main>
  );
}

function Dashboard({ session, onLogout }: { session: Session; onLogout: () => void }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [confirming, setConfirming] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const r = await fetch(`/api/bipi/business/${session.businessId}/dashboard`, {
        headers: { Authorization: `Bearer ${session.token}` }
      });
      if (r.ok) setData(await r.json());
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
    // Auto-refresh pendientes cada 10s
    const i = setInterval(load, 10_000);
    return () => clearInterval(i);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function act(purchaseId: string, action: "confirm" | "reject") {
    setConfirming(purchaseId);
    try {
      const r = await fetch("/api/bipi/purchase/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.token}` },
        body: JSON.stringify({ purchaseId, businessId: session.businessId, action })
      });
      if (!r.ok) {
        const j = await r.json();
        alert(j?.error?.message ?? `Error ${r.status}`);
      }
      await load();
    } finally {
      setConfirming(null);
    }
  }

  if (loading || !data) return <main className="max-w-3xl mx-auto px-4 py-12">Cargando…</main>;
  const b = data.business;
  const m = data.metrics;

  return (
    <main className="max-w-4xl mx-auto px-4 py-8 space-y-6">
      <div className="flex items-center justify-between bipi-fade-up">
        <div>
          <h1 className="text-2xl font-black tracking-tight">{b.name}</h1>
          <p className="text-xs text-black/55">
            {b.category} · {b.city} · Plan {b.plan} · Karma {b.visibilityScore}/100
          </p>
        </div>
        <button onClick={onLogout} className="text-xs text-black/45 hover:text-black/70">Cerrar sesión</button>
      </div>

      {/* Resumen — tarjeta oscura con gráfica de ventas + métricas */}
      <section className="bipi-fade-up bipi-fade-up-1 space-y-3">
        <div className="rounded-2xl p-5 text-white" style={{ background: "linear-gradient(160deg,#1A1A1A,#0A0A0A)" }}>
          <div className="flex items-start justify-between">
            <div>
              <div className="text-[11px] uppercase tracking-wider text-white/50 font-bold">Ventas Bipi · 30 días</div>
              <div className="text-4xl font-black mt-1">
                {(m.revenue30 ?? 0).toLocaleString("es-ES", { maximumFractionDigits: 0 })} €
              </div>
            </div>
            {typeof m.deltas?.scans7 === "number" && (
              <div className={"text-xs font-bold px-2 py-1 rounded-full " + (m.deltas.scans7 >= 0 ? "bg-emerald-500/20 text-emerald-300" : "bg-rose-500/20 text-rose-300")}>
                {m.deltas.scans7 >= 0 ? "↗" : "↘"} {Math.abs(m.deltas.scans7)}% escaneos 7d
              </div>
            )}
          </div>
          <SalesChart data={m.dailyRevenue ?? []} />
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <MetricCard label="Ventas 30d" value={m.scans30} sub="confirmadas" />
          <MetricCard label="Nuevos clientes" value={m.newCustomers30 ?? 0} sub="30 días" />
          <MetricCard label="Ticket medio" value={`${(m.ticketMedio ?? 0).toFixed(2)} €`} />
          <MetricCard label="Escaneos 7d" value={m.scans7} />
        </div>
      </section>

      {/* QR descargable */}
      <section className="bg-white border rounded-xl p-5 shadow-sm flex items-start gap-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={b.qrPngUrl} alt="QR" className="w-32 h-32 border rounded" />
        <div className="flex-1">
          <h3 className="font-semibold text-sm">Tu QR</h3>
          <p className="text-xs text-slate-600 mb-2">Imprímelo y ponlo en la caja. Cada escaneo sube tu karma y te hace más visible.</p>
          <div className="flex items-center gap-2 flex-wrap">
            <a href={b.qrPngUrl} download className="text-sm text-pink-600 hover:underline">Descargar PNG</a>
            <span className="text-slate-400">·</span>
            <CsvDownloadButton businessId={b.id} token={session.token} />
          </div>
        </div>
      </section>

      {/* Comparte tu página pública */}
      <ShareWidget slug={b.slug} name={b.name} discountPct={b.defaultDiscountPct} />

      {/* Plan + Upgrade */}
      <PlanCard business={b} />

      {/* Editar perfil */}
      <ProfileEditor business={b} token={session.token} onSaved={load} />

      {/* Programa de afiliados — lo financia el negocio */}
      <ReferralConfig business={b} token={session.token} onSaved={load} />

      {/* Cruces — la mina de datos */}
      <CrossShopperPanel businessId={b.id} token={session.token} />

      {/* Crear Push del Día */}
      <PushAdForm businessId={b.id} businessName={b.name} />


      {/* Pendientes — estilo tabla compacta como en el mockup */}
      <section className="bipi-card p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-bold text-sm">Últimas transacciones · pendientes</h3>
          <span className="text-xs text-black/50">{data.pending.length}</span>
        </div>
        {data.pending.length === 0 ? (
          <div className="py-6 text-center text-sm text-black/55">
            Sin compras pendientes. Cuando un cliente escanee, aparecerá aquí.
          </div>
        ) : (
          <div className="bipi-table">
            {data.pending.map((p: any) => {
              const initial = (p.customer.name ?? p.customer.email ?? "?").charAt(0).toUpperCase();
              return (
                <div key={p.id} className="row">
                  <div className="left min-w-0">
                    <div className="avatar">{initial}</div>
                    <div className="min-w-0">
                      <div className="name truncate">
                        {p.customer.name ?? p.customer.email}
                        {p.offerRedeemed && <span className="ml-1.5 text-[10px] font-bold text-pink-600">🎟 CRUZADO</span>}
                      </div>
                      <div className="sub">
                        {new Date(p.scannedAt).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })} · {p.discountPct}% off
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="amount mr-2">{p.amount.toFixed(2)} €</div>
                    <button
                      onClick={() => act(p.id, "reject")}
                      disabled={confirming === p.id}
                      className="px-3 py-1.5 rounded-full border border-black/15 bg-white hover:bg-black/5 text-xs font-semibold disabled:opacity-50"
                    >
                      Rechazar
                    </button>
                    <button
                      onClick={() => act(p.id, "confirm")}
                      disabled={confirming === p.id}
                      className="px-3 py-1.5 rounded-full bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold disabled:opacity-50"
                    >
                      Confirmar
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}

/** Botón para descargar CSV con las compras confirmadas del negocio.
 *  Usa fetch para incluir el header Authorization, crea blob y dispara
 *  descarga (no se puede hacer con <a download> porque no permite headers). */
function CsvDownloadButton({ businessId, token }: { businessId: string; token: string }) {
  const [busy, setBusy] = useState(false);
  async function go() {
    setBusy(true);
    try {
      const r = await fetch(`/api/bipi/business/${businessId}/purchases.csv`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!r.ok) {
        alert("No se pudo descargar el CSV.");
        return;
      }
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `bipi-compras-${businessId.slice(0, 8)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } finally {
      setBusy(false);
    }
  }
  return (
    <button
      onClick={go}
      disabled={busy}
      className="text-sm text-pink-600 hover:underline disabled:opacity-50"
    >
      {busy ? "Generando…" : "Descargar CSV compras"}
    </button>
  );
}

/** Widget de compartir página pública. Native Web Share API si está
 *  disponible (móvil), si no fallback a deep links de WhatsApp/Telegram
 *  + botón "copiar URL" con feedback. */
/** Configuración del programa de afiliados: recompensas por hito (1/3/5)
 *  que financia este negocio. */
function ReferralConfig({ business, token, onSaved }: { business: any; token: string; onSaved: () => void }) {
  const [enabled, setEnabled] = useState<boolean>(business.referralEnabled ?? true);
  const [r1, setR1] = useState(business.referralReward1 ?? "5% de descuento extra");
  const [r3, setR3] = useState(business.referralReward3 ?? "10% de descuento");
  const [r5, setR5] = useState(business.referralReward5 ?? "Tapa o postre gratis");
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setStatus(null);
    try {
      const r = await fetch(`/api/bipi/business/${business.id}/profile`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          referralEnabled: enabled,
          referralReward1: r1 || null,
          referralReward3: r3 || null,
          referralReward5: r5 || null
        })
      });
      setStatus(r.ok ? "Guardado." : "Error al guardar.");
      if (r.ok) onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="bipi-card p-5 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-bold text-sm">🎁 Programa "Trae amigos"</h3>
          <p className="text-xs text-black/55 mt-0.5">
            Tus clientes invitan; al llegar a 1, 3 y 5 amigos verificados, tú les das estas recompensas. Captación baratísima.
          </p>
        </div>
        <label className="flex items-center gap-2 text-xs font-semibold shrink-0">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          Activo
        </label>
      </div>
      {enabled && (
        <div className="space-y-2">
          {[
            { n: 1, v: r1, set: setR1 },
            { n: 3, v: r3, set: setR3 },
            { n: 5, v: r5, set: setR5 }
          ].map((m) => (
            <label key={m.n} className="flex items-center gap-2 text-xs">
              <span className="w-20 font-semibold text-black/60">{m.n} {m.n === 1 ? "amigo" : "amigos"}</span>
              <input
                value={m.v}
                onChange={(e) => m.set(e.target.value)}
                placeholder="Recompensa (ej: Tapa gratis)"
                className="flex-1 px-2 py-1.5 border rounded bg-white"
              />
            </label>
          ))}
        </div>
      )}
      {status && <p className="text-xs text-emerald-700">{status}</p>}
      <button onClick={save} disabled={saving} className="bipi-btn w-full text-sm py-2">
        {saving ? "Guardando…" : "Guardar afiliados"}
      </button>
    </section>
  );
}

function ShareWidget({ slug, name, discountPct }: { slug: string; name: string; discountPct: number }) {
  const [copied, setCopied] = useState(false);
  const [origin, setOrigin] = useState("");
  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);
  const url = origin ? `${origin}/bipi/n/${slug}` : `/bipi/n/${slug}`;
  const shareText = `${discountPct}% en ${name} con la app Bipi 🎟\nEscanea, paga, y se te abren descuentos en otros negocios cerca.`;
  const fullMessage = `${shareText}\n${url}`;

  async function nativeShare() {
    if (typeof navigator !== "undefined" && (navigator as any).share) {
      try {
        await (navigator as any).share({ title: `${name} · Bipi`, text: shareText, url });
        return;
      } catch {
        // user cancelled
      }
    }
    // Fallback: copiar.
    await copy();
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  }

  const wa = `https://wa.me/?text=${encodeURIComponent(fullMessage)}`;
  const tg = `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(shareText)}`;
  const fb = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`;

  return (
    <section className="bipi-card p-5 space-y-3">
      <div>
        <h3 className="font-bold text-sm">📣 Comparte tu Bipi</h3>
        <p className="text-xs text-black/55 mt-0.5">
          Cada vez que un cliente entra por tu enlace, te ahorras anuncios y subes karma.
        </p>
      </div>
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-black/10 bg-pink-50/40">
        <span className="text-xs text-black/70 font-mono truncate flex-1">{url || "—"}</span>
        <button
          onClick={copy}
          className="px-3 py-1 rounded-full bg-black text-white text-xs font-bold hover:bg-pink-600 transition"
        >
          {copied ? "✓ Copiado" : "Copiar"}
        </button>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <button onClick={nativeShare} className="bipi-btn text-xs py-2">
          📲 Compartir
        </button>
        <a
          href={wa}
          target="_blank"
          rel="noopener noreferrer"
          className="text-center text-xs py-2 px-3 rounded-full border-2 border-emerald-500 text-emerald-700 font-bold hover:bg-emerald-50 transition"
        >
          WhatsApp
        </a>
        <a
          href={tg}
          target="_blank"
          rel="noopener noreferrer"
          className="text-center text-xs py-2 px-3 rounded-full border-2 border-sky-500 text-sky-700 font-bold hover:bg-sky-50 transition"
        >
          Telegram
        </a>
        <a
          href={fb}
          target="_blank"
          rel="noopener noreferrer"
          className="text-center text-xs py-2 px-3 rounded-full border-2 border-blue-600 text-blue-700 font-bold hover:bg-blue-50 transition"
        >
          Facebook
        </a>
      </div>
      <p className="text-[11px] text-black/50">
        💡 Pégalo en tu bio de Instagram, en tu firma de email o en una historia. Cada visita es un cliente potencial.
      </p>
    </section>
  );
}

/** Editor de perfil del negocio. Permite cambiar descripción, dirección,
 *  geo coords, logo URL, brand color y los % de descuento. Lo que se
 *  cambie aquí impacta la página pública (/bipi/n/<slug>) y el cartel. */
function ProfileEditor({ business, token, onSaved }: { business: any; token: string; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    description: business.description ?? "",
    address: business.address ?? "",
    latitude: business.latitude ?? "",
    longitude: business.longitude ?? "",
    logoUrl: business.logoUrl ?? "",
    brandColor: business.brandColor ?? "#FDF2E1",
    defaultDiscountPct: business.defaultDiscountPct ?? 5,
    crossDiscountPct: business.crossDiscountPct ?? 8,
    purchaseMode: business.purchaseMode ?? "double_confirm"
  });
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ kind: "ok" | "err"; msg: string } | null>(null);

  async function save() {
    setSaving(true);
    setStatus(null);
    try {
      const payload: any = {};
      if (form.description !== business.description) payload.description = form.description || null;
      if (form.address !== business.address) payload.address = form.address || null;
      if (form.latitude !== "" && Number(form.latitude) !== business.latitude) payload.latitude = Number(form.latitude);
      if (form.longitude !== "" && Number(form.longitude) !== business.longitude) payload.longitude = Number(form.longitude);
      if (form.logoUrl !== business.logoUrl) payload.logoUrl = form.logoUrl || null;
      if (form.brandColor !== business.brandColor) payload.brandColor = form.brandColor || null;
      if (Number(form.defaultDiscountPct) !== business.defaultDiscountPct) payload.defaultDiscountPct = Number(form.defaultDiscountPct);
      if (Number(form.crossDiscountPct) !== business.crossDiscountPct) payload.crossDiscountPct = Number(form.crossDiscountPct);
      if (form.purchaseMode !== business.purchaseMode) payload.purchaseMode = form.purchaseMode;
      if (Object.keys(payload).length === 0) {
        setStatus({ kind: "ok", msg: "Sin cambios." });
        return;
      }
      const r = await fetch(`/api/bipi/business/${business.id}/profile`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload)
      });
      const j = await r.json();
      if (!r.ok) {
        setStatus({ kind: "err", msg: j?.error?.message ?? `Error ${r.status}` });
        return;
      }
      setStatus({ kind: "ok", msg: "Guardado." });
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <section className="bg-white border rounded-xl p-5 shadow-sm flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-sm">✏️ Editar perfil</h3>
          <p className="text-xs text-slate-600">
            Logo, descripción, dirección, color de marca y % de descuento.
          </p>
        </div>
        <button
          onClick={() => setOpen(true)}
          className="px-3 py-1.5 rounded-lg border bg-white hover:bg-slate-50 text-xs font-medium"
        >
          Abrir editor
        </button>
      </section>
    );
  }

  return (
    <section className="bg-white border rounded-xl p-5 shadow-sm space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-sm">✏️ Editar perfil</h3>
        <button onClick={() => setOpen(false)} className="text-xs text-slate-500 hover:underline">Cerrar</button>
      </div>
      <div className="grid sm:grid-cols-2 gap-2 text-xs">
        <label>
          <span className="block font-medium mb-1">Descripción</span>
          <textarea
            rows={3}
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            className="w-full px-2 py-1.5 border rounded bg-white"
          />
        </label>
        <label>
          <span className="block font-medium mb-1">URL del logo</span>
          <input
            value={form.logoUrl}
            onChange={(e) => setForm({ ...form, logoUrl: e.target.value })}
            placeholder="https://…"
            className="w-full px-2 py-1.5 border rounded bg-white"
          />
        </label>
        <label className="sm:col-span-2">
          <span className="block font-medium mb-1">Dirección</span>
          <input
            value={form.address}
            onChange={(e) => setForm({ ...form, address: e.target.value })}
            className="w-full px-2 py-1.5 border rounded bg-white"
          />
        </label>
        <label>
          <span className="block font-medium mb-1">Latitud</span>
          <input
            type="number"
            step="any"
            value={form.latitude}
            onChange={(e) => setForm({ ...form, latitude: e.target.value })}
            className="w-full px-2 py-1.5 border rounded bg-white"
          />
        </label>
        <label>
          <span className="block font-medium mb-1">Longitud</span>
          <input
            type="number"
            step="any"
            value={form.longitude}
            onChange={(e) => setForm({ ...form, longitude: e.target.value })}
            className="w-full px-2 py-1.5 border rounded bg-white"
          />
        </label>
        <label>
          <span className="block font-medium mb-1">Color de marca</span>
          <input
            type="color"
            value={form.brandColor}
            onChange={(e) => setForm({ ...form, brandColor: e.target.value })}
            className="w-full h-9 border rounded bg-white"
          />
        </label>
        <label>
          <span className="block font-medium mb-1">Modo de compra</span>
          <select
            value={form.purchaseMode}
            onChange={(e) => setForm({ ...form, purchaseMode: e.target.value })}
            className="w-full px-2 py-1.5 border rounded bg-white"
          >
            <option value="double_confirm">Doble confirmación (anti-fraude)</option>
            <option value="express">Express (sin confirmar)</option>
          </select>
        </label>
        <label>
          <span className="block font-medium mb-1">% descuento al escanear</span>
          <input
            type="number"
            min={3}
            max={30}
            value={form.defaultDiscountPct}
            onChange={(e) => setForm({ ...form, defaultDiscountPct: Number(e.target.value) })}
            className="w-full px-2 py-1.5 border rounded bg-white"
          />
        </label>
        <label>
          <span className="block font-medium mb-1">% descuento con cupón cruzado</span>
          <input
            type="number"
            min={3}
            max={30}
            value={form.crossDiscountPct}
            onChange={(e) => setForm({ ...form, crossDiscountPct: Number(e.target.value) })}
            className="w-full px-2 py-1.5 border rounded bg-white"
          />
        </label>
      </div>
      <p className="text-[11px] text-slate-500">
        Consejo: si no sabes lat/lng, búscalo en Google Maps (clic derecho → coordenadas). Sin coordenadas no se puede activar el geofencing ni el anti-fraude.
      </p>
      {status && (
        <p className={"text-xs " + (status.kind === "ok" ? "text-emerald-700" : "text-rose-700")}>
          {status.msg}
        </p>
      )}
      <button
        onClick={save}
        disabled={saving}
        className="w-full py-2 rounded-full bg-pink-500 hover:bg-pink-600 text-white text-sm font-medium disabled:opacity-50"
      >
        {saving ? "Guardando…" : "Guardar cambios"}
      </button>
    </section>
  );
}

/** Panel "Cruces" — muestra a qué negocios el actual envía clientes y de
 *  cuáles recibe. Esto es el dato más valioso de Bipi: la red de tráfico
 *  cruzado que ningún Meta/Google sabe ver. */
function CrossShopperPanel({ businessId, token }: { businessId: string; token: string }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    fetch(`/api/bipi/business/${businessId}/cross-shopper`, {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setData(d))
      .finally(() => setLoading(false));
  }, [businessId, token]);
  if (loading) {
    return <div className="bg-white border rounded-xl p-5 shadow-sm text-sm text-slate-500">Calculando cruces…</div>;
  }
  if (!data) return null;
  const s = data.summary;
  return (
    <section className="bg-white border rounded-xl p-5 shadow-sm space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h3 className="font-semibold text-sm">🔁 Red de cruces</h3>
          <p className="text-xs text-slate-600">A quién mandas clientes y quién te los manda a ti.</p>
        </div>
        <div className="text-xs text-slate-600">
          <span className="font-semibold text-pink-600">{s.conversionPct}%</span> de tus cupones se canjean
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 text-xs">
        <SmallStat label="Cupones generados" value={s.cuponesGenerados} />
        <SmallStat label="Canjeados (otros)" value={s.canjeadosPorOtros} />
        <SmallStat label="Recibidos canjeados" value={s.cuponesRecibidosCanjeados} />
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <div>
          <h4 className="text-xs font-semibold text-slate-700 mb-2">📤 Mandas clientes a</h4>
          {data.sentTo.length === 0 ? (
            <p className="text-xs text-slate-500">Aún sin datos. Cuando un cliente que compre aquí canjee en otro negocio, aparecerá.</p>
          ) : (
            <ul className="space-y-1.5">
              {data.sentTo.slice(0, 6).map((r: any) => (
                <li key={r.business.id} className="flex items-center justify-between text-xs">
                  <span className="truncate">
                    <span className="font-medium">{r.business.name}</span>
                    <span className="text-slate-400 ml-1">{r.business.category}</span>
                  </span>
                  <span className="text-pink-600 font-semibold whitespace-nowrap ml-2">
                    {r.redeemed}/{r.total} · {r.conversionPct}%
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <h4 className="text-xs font-semibold text-slate-700 mb-2">📥 Recibes clientes de</h4>
          {data.receivedFrom.length === 0 ? (
            <p className="text-xs text-slate-500">Aún sin datos. Cuando un cliente con cupón cruzado venga aquí, aparecerá.</p>
          ) : (
            <ul className="space-y-1.5">
              {data.receivedFrom.slice(0, 6).map((r: any) => (
                <li key={r.business.id} className="flex items-center justify-between text-xs">
                  <span className="truncate">
                    <span className="font-medium">{r.business.name}</span>
                    <span className="text-slate-400 ml-1">{r.business.category}</span>
                  </span>
                  <span className="text-emerald-700 font-semibold whitespace-nowrap ml-2">
                    +{r.redeemed}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}

function SmallStat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-lg bg-slate-50 border p-2 text-center">
      <div className="text-[10px] text-slate-500 uppercase tracking-wide">{label}</div>
      <div className="text-lg font-bold">{value}</div>
    </div>
  );
}

function PlanCard({ business }: { business: any }) {
  const [busy, setBusy] = useState<string | null>(null);
  async function upgrade(plan: "pro" | "premium") {
    setBusy(plan);
    try {
      const r = await fetch("/api/bipi/stripe/checkout-subscription", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessId: business.id, plan })
      });
      const j = await r.json();
      if (!r.ok || !j.url) {
        alert(j?.error?.message ?? "No se pudo crear el checkout");
        return;
      }
      window.location.href = j.url;
    } finally {
      setBusy(null);
    }
  }
  return (
    <section className="bg-white border rounded-xl p-5 shadow-sm">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h3 className="font-semibold text-sm">Tu plan: <span className="text-pink-600 capitalize">{business.plan}</span></h3>
          <p className="text-xs text-slate-600">
            {business.plan === "free"
              ? "Aparece en feed (según karma). Sube de plan para destacar y recibir más clientes."
              : "Tienes ventajas Pro/Premium activas."}
          </p>
        </div>
      </div>
      {business.plan === "free" && (
        <div className="grid sm:grid-cols-2 gap-2 mt-3">
          <button
            onClick={() => upgrade("pro")}
            disabled={busy !== null}
            className="text-left p-3 rounded-lg border border-pink-300 hover:bg-pink-50 disabled:opacity-50"
          >
            <div className="font-semibold">⭐ Pro · 29€/mes</div>
            <div className="text-xs text-slate-600 mt-1">+ 1 push gratis/mes · AI Studio · analytics avanzado</div>
          </button>
          <button
            onClick={() => upgrade("premium")}
            disabled={busy !== null}
            className="text-left p-3 rounded-lg border border-rose-300 hover:bg-rose-50 disabled:opacity-50"
          >
            <div className="font-semibold">🔥 Premium · 99€/mes</div>
            <div className="text-xs text-slate-600 mt-1">+ 4 push gratis/mes · -25% en push extra · soporte prioritario</div>
          </button>
        </div>
      )}
    </section>
  );
}

function PushAdForm({ businessId, businessName }: { businessId: string; businessName: string }) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [radiusKm, setRadiusKm] = useState(1);
  const [quote, setQuote] = useState<{ reach: number; priceEur: number } | null>(null);
  const [busy, setBusy] = useState(false);
  // AI Studio state
  const [brief, setBrief] = useState("");
  const [vibe, setVibe] = useState<"cercano" | "directo" | "premium" | "divertido">("cercano");
  const [variantes, setVariantes] = useState<any[] | null>(null);
  const [generating, setGenerating] = useState(false);

  async function generateCopy() {
    if (!brief.trim()) return;
    setGenerating(true);
    setVariantes(null);
    try {
      const r = await fetch("/api/bipi/ai-studio/push-copy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessId, productOrOffer: brief.trim(), vibe })
      });
      const j = await r.json();
      if (j.variantes) setVariantes(j.variantes);
    } finally {
      setGenerating(false);
    }
  }
  function pickVariante(v: any) {
    setTitle(v.titulo);
    setBody(v.body);
  }
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const r = await fetch("/api/bipi/push-quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessId, radiusKm })
      });
      if (cancelled) return;
      if (r.ok) setQuote(await r.json());
    })();
    return () => { cancelled = true; };
  }, [businessId, radiusKm]);

  async function pay() {
    if (!title.trim() || !body.trim()) return;
    setBusy(true);
    try {
      const r = await fetch("/api/bipi/stripe/checkout-push-ad", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessId, title, body, radiusKm })
      });
      const j = await r.json();
      if (!r.ok || !j.url) {
        alert(j?.error?.message ?? "No se pudo crear el pago");
        return;
      }
      window.location.href = j.url;
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="bg-white border rounded-xl p-5 shadow-sm space-y-3">
      <h3 className="font-semibold text-sm">📣 Push del Día</h3>
      <p className="text-xs text-slate-600">
        Envía una notificación push a clientes Bipi cerca de tu local. 24h activa.
      </p>

      {/* AI Studio — copy automático */}
      <div className="rounded-lg border border-violet-200 bg-violet-50/40 p-3 space-y-2">
        <div className="text-[11px] font-semibold text-violet-900">✨ Vivo Studio · copy automático con IA</div>
        <textarea
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
          placeholder="¿Qué quieres promocionar? (ej: 30% en cortes hasta las 20h, menú degustación esta noche…)"
          rows={2}
          className="w-full px-2 py-1.5 border rounded text-xs bg-white"
        />
        <div className="flex items-center gap-2">
          <select value={vibe} onChange={(e) => setVibe(e.target.value as any)} className="px-2 py-1 border rounded text-xs bg-white">
            <option value="cercano">Cercano</option>
            <option value="directo">Directo</option>
            <option value="premium">Premium</option>
            <option value="divertido">Divertido</option>
          </select>
          <button
            type="button"
            onClick={generateCopy}
            disabled={generating || !brief.trim()}
            className="px-3 py-1.5 rounded-full bg-violet-600 hover:bg-violet-700 text-white text-xs font-medium disabled:opacity-50"
          >
            {generating ? "Generando…" : "Generar 3 variantes"}
          </button>
        </div>
        {variantes && (
          <div className="space-y-2 mt-2">
            {variantes.map((v: any, i: number) => (
              <button
                key={i}
                type="button"
                onClick={() => pickVariante(v)}
                className="w-full text-left p-2 rounded-lg border border-violet-200 bg-white hover:bg-violet-50"
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] font-semibold text-violet-700 uppercase">{v.angulo}</span>
                  <span className="text-[10px] text-slate-500">{v.horarioSugerido}</span>
                </div>
                <div className="text-xs font-semibold text-slate-900">{v.titulo}</div>
                <div className="text-[11px] text-slate-600 mt-0.5">{v.body}</div>
              </button>
            ))}
            <p className="text-[10px] text-slate-500">Toca una variante para usarla.</p>
          </div>
        )}
      </div>

      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Título (ej: ¡Hoy 30% en cortes hasta las 20h!)"
        className="w-full px-3 py-2 border rounded-lg bg-white text-sm"
      />
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Mensaje del push (1-2 frases con gancho)"
        rows={2}
        className="w-full px-3 py-2 border rounded-lg bg-white text-sm"
      />

      {/* Preview en vivo del push */}
      <PushPreview businessName={businessName} title={title} body={body} />

      <div className="flex items-center justify-between text-sm">
        <label className="flex items-center gap-2">
          Radio:
          <select value={radiusKm} onChange={(e) => setRadiusKm(Number(e.target.value))} className="border rounded px-2 py-1">
            <option value={0.5}>500 m</option>
            <option value={1}>1 km</option>
            <option value={2}>2 km</option>
            <option value={3}>3 km</option>
            <option value={5}>5 km</option>
          </select>
        </label>
        {quote && (
          <div className="text-xs text-slate-600">
            ~{quote.reach} usuarios · <strong className="text-pink-600">{quote.priceEur}€</strong>
          </div>
        )}
      </div>
      <button
        onClick={pay}
        disabled={busy || !title.trim() || !body.trim()}
        className="w-full py-2.5 rounded-full bg-pink-500 hover:bg-pink-600 text-white font-medium disabled:opacity-50"
      >
        {busy ? "Procesando…" : `Pagar y lanzar (${quote?.priceEur ?? "—"} €)`}
      </button>
    </section>
  );
}

/** Mockup visual del push tal y como lo verá el cliente. Doble vista:
 *  iOS (lockscreen card) + Android (banner top). */
function PushPreview({ businessName, title, body }: { businessName: string; title: string; body: string }) {
  const [mode, setMode] = useState<"ios" | "android">("ios");
  const now = new Date();
  const hh = now.getHours().toString().padStart(2, "0");
  const mm = now.getMinutes().toString().padStart(2, "0");

  const displayTitle = title.trim() || "Tu título aparecerá aquí";
  const displayBody = body.trim() || "Y tu mensaje justo debajo. Cuanto más concreto, más conversión.";

  return (
    <div className="rounded-xl border border-black/10 bg-gradient-to-br from-slate-50 to-pink-50/40 p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="text-[11px] font-bold uppercase tracking-wider text-black/55">
          Preview · cómo lo ve el cliente
        </div>
        <div className="flex items-center gap-1 text-[10px] font-bold">
          <button
            type="button"
            onClick={() => setMode("ios")}
            className={"px-2 py-0.5 rounded-full " + (mode === "ios" ? "bg-black text-white" : "text-black/55")}
          >
            iOS
          </button>
          <button
            type="button"
            onClick={() => setMode("android")}
            className={"px-2 py-0.5 rounded-full " + (mode === "android" ? "bg-black text-white" : "text-black/55")}
          >
            Android
          </button>
        </div>
      </div>

      {mode === "ios" ? (
        <div className="bg-white/90 backdrop-blur rounded-2xl px-3.5 py-3 shadow-sm border border-black/5">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-pink-500 to-pink-600 grid place-items-center text-white font-black text-sm shadow">
              B
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between">
                <div className="text-[11px] font-bold text-black/75">BIPI</div>
                <div className="text-[10px] text-black/45">ahora</div>
              </div>
              <div className="text-[13px] font-bold text-black truncate">{displayTitle}</div>
              <div className="text-[12px] text-black/70 leading-snug line-clamp-2">{displayBody}</div>
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-lg px-3.5 py-2.5 shadow-sm border border-black/5">
          <div className="flex items-center gap-2 text-[10px] text-black/55 font-semibold uppercase tracking-wider mb-1">
            <div className="w-3.5 h-3.5 rounded-sm bg-gradient-to-br from-pink-500 to-pink-600" />
            <span>Bipi · {businessName}</span>
            <span className="ml-auto">{hh}:{mm}</span>
          </div>
          <div className="text-[13px] font-bold text-black">{displayTitle}</div>
          <div className="text-[12px] text-black/70 leading-snug">{displayBody}</div>
        </div>
      )}

      <div className="mt-3 grid grid-cols-2 gap-2 text-[10px]">
        <Hint
          ok={displayTitle.length >= 6 && displayTitle.length <= 65 && !!title.trim()}
          label={`Título · ${title.trim().length}/65`}
        />
        <Hint
          ok={displayBody.length >= 20 && displayBody.length <= 140 && !!body.trim()}
          label={`Mensaje · ${body.trim().length}/140`}
        />
      </div>
    </div>
  );
}

function Hint({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div
      className={
        "px-2 py-1 rounded font-bold " +
        (ok ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-amber-50 text-amber-800 border border-amber-200")
      }
    >
      {ok ? "✓" : "⚠"} {label}
    </div>
  );
}

function Metric({ label, value, sub }: { label: string; value: number | string; sub?: string }) {
  return (
    <div className="bg-white border rounded-xl p-4 shadow-sm">
      <div className="text-[11px] text-slate-500 uppercase tracking-wide">{label}</div>
      <div className="text-2xl font-bold mt-1">{value}</div>
      {sub && <div className="text-[10px] text-slate-400">{sub}</div>}
    </div>
  );
}

/** Gráfica de área SVG (ventas diarias) sobre la tarjeta oscura. */
function SalesChart({ data }: { data: { day: string; total: number }[] }) {
  const W = 320, H = 90, pad = 4;
  if (!data || data.length < 2) {
    return <div className="mt-4 h-[90px] grid place-items-center text-white/30 text-xs">Aún sin ventas para la gráfica</div>;
  }
  const max = Math.max(1, ...data.map((d) => d.total));
  const stepX = (W - pad * 2) / (data.length - 1);
  const pts = data.map((d, i) => {
    const x = pad + i * stepX;
    const y = H - pad - (d.total / max) * (H - pad * 2);
    return [x, y] as const;
  });
  const line = pts.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${line} L${pts[pts.length - 1][0].toFixed(1)},${H} L${pts[0][0].toFixed(1)},${H} Z`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="90" className="mt-4 overflow-visible">
      <defs>
        <linearGradient id="salesfill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#EC4899" stopOpacity="0.55" />
          <stop offset="1" stopColor="#EC4899" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#salesfill)" />
      <path d={line} fill="none" stroke="#F472B6" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r="3.5" fill="#fff" />
    </svg>
  );
}

function MetricCard({ label, value, sub }: { label: string; value: number | string; sub?: string }) {
  return (
    <div className="bipi-card p-3">
      <div className="text-[10px] uppercase tracking-wide text-black/50 font-bold">{label}</div>
      <div className="text-xl font-black mt-0.5">{value}</div>
      {sub && <div className="text-[10px] text-black/45">{sub}</div>}
    </div>
  );
}

function MiniMetric({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-xl bg-pink-50/60 border border-pink-100 p-2.5 text-center">
      <div className="text-[10px] uppercase tracking-wide text-black/55 font-bold">{label}</div>
      <div className="text-lg font-black mt-0.5">{value}</div>
    </div>
  );
}
