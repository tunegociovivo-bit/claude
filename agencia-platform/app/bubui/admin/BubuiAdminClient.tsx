"use client";

import { useEffect, useState } from "react";
import { signOut } from "next-auth/react";

type Overview = {
  scope: { city: string };
  summary: {
    businesses: number;
    customers: number;
    purchases30: number;
    offers30: number;
    offersRedeemed30: number;
    conversionPct: number;
    revenue30: number;
  };
  plansBreakdown: Array<{ plan: string; count: number }>;
  topByScanning: Array<{ business: any; scans: number }>;
  topByCross: Array<{ business: any; redeemed: number }>;
};

type AdminTab = "overview" | "users" | "businesses" | "banner" | "push";

export default function BubuiAdminClient() {
  const [data, setData] = useState<Overview | null>(null);
  const [city, setCity] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<AdminTab>("overview");

  async function load(cityFilter: string) {
    setLoading(true);
    setError(null);
    try {
      const url = new URL("/api/bubui/admin/overview", window.location.origin);
      if (cityFilter) url.searchParams.set("city", cityFilter);
      const r = await fetch(url.toString());
      if (r.status === 401) {
        // Sesión perdida — al login con vuelta a este panel.
        window.location.href = "/login?callbackUrl=/bubui/admin";
        return;
      }
      if (!r.ok) {
        setError(`Error ${r.status}`);
        return;
      }
      setData(await r.json());
    } catch (e: any) {
      setError(e?.message ?? "Error de red");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load(city);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [city]);

  return (
    <main className="max-w-5xl mx-auto px-4 py-8 space-y-6">
      <header className="flex items-center justify-between gap-2 flex-wrap bubui-fade-up">
        <div className="flex items-center gap-3">
          <span className="bubui-wordmark" style={{ fontSize: 32 }}>bubui</span>
          <div>
            <div className="text-xs font-bold uppercase tracking-wider text-black/55">Admin</div>
            <p className="text-[11px] text-black/45">
              Vista global de la red · {data?.scope.city ?? "todas las ciudades"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <input
            value={city}
            onChange={(e) => setCity(e.target.value)}
            placeholder="Filtrar por ciudad"
            className="bubui-input text-sm py-1.5"
            style={{ width: 180 }}
          />
          <button
            onClick={() => signOut({ callbackUrl: "/login" })}
            className="text-xs text-black/45 hover:text-black/70 font-semibold"
          >
            Salir
          </button>
        </div>
      </header>

      <nav className="flex gap-2 flex-wrap bubui-fade-up">
        {([
          ["overview", "Resumen"],
          ["users", "Usuarios"],
          ["businesses", "Comercios"],
          ["banner", "Banner"],
          ["push", "Push"]
        ] as [AdminTab, string][]).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className="bubui-chip"
            style={tab === k ? { background: "#ec1c6e", color: "#fff" } : { cursor: "pointer" }}
          >
            {label}
          </button>
        ))}
      </nav>

      {tab === "users" && <UsersPanel />}
      {tab === "businesses" && <BusinessesPanel />}
      {tab === "banner" && <BannerPanel />}
      {tab === "push" && <PushPanel />}

      {tab === "overview" && (
      <>
      {error && <div className="text-rose-700 text-sm">{error}</div>}
      {loading && !data && (
        <div className="space-y-3">
          <div className="bubui-skeleton h-28" />
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[1, 2, 3, 4, 5, 6].map((i) => <div key={i} className="bubui-skeleton h-20" />)}
          </div>
        </div>
      )}

      {data && (
        <>
          {/* Stat hero — ventas de la red */}
          <section className="bubui-card p-6 bubui-fade-up bubui-fade-up-1">
            <div className="flex items-end justify-between flex-wrap gap-4">
              <div className="bubui-stat-hero">
                <div className="label">Ventas de la red · 30d</div>
                <div className="value">{(data.summary.revenue30 ?? 0).toLocaleString("es-ES", { maximumFractionDigits: 0 })} €</div>
                <div className="sub">
                  {data.summary.conversionPct}% de cupones canjeados · {data.summary.offersRedeemed30}/{data.summary.offers30}
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2 min-w-[280px]">
                <MiniStat label="Negocios" value={data.summary.businesses} />
                <MiniStat label="Clientes" value={data.summary.customers} />
                <MiniStat label="Compras 30d" value={data.summary.purchases30} />
              </div>
            </div>
            {data.plansBreakdown.length > 0 && (
              <div className="mt-4 pt-4 border-t border-black/5 flex items-center gap-2 flex-wrap">
                <span className="text-[11px] font-bold uppercase tracking-wider text-black/45">Planes:</span>
                {data.plansBreakdown.map((p) => (
                  <span key={p.plan} className="bubui-chip" style={{ cursor: "default" }}>
                    {p.plan} · {p.count}
                  </span>
                ))}
              </div>
            )}
          </section>

          <section className="bubui-card p-5 bubui-fade-up bubui-fade-up-2">
            <h2 className="text-sm font-bold mb-3">🔥 Top escaneos · 7 días</h2>
            <RankTable
              rows={data.topByScanning.map((r) => ({
                business: r.business,
                extra: `Karma ${r.business.visibilityScore}`,
                value: r.scans
              }))}
              valueLabel="escaneos"
              empty="Aún sin escaneos en este periodo."
            />
          </section>

          <section className="bubui-card p-5 bubui-fade-up bubui-fade-up-3">
            <h2 className="text-sm font-bold mb-3">🎟 Top cupones canjeados recibidos · 30 días</h2>
            <RankTable
              rows={data.topByCross.map((r) => ({
                business: r.business,
                extra: r.business.city,
                value: r.redeemed
              }))}
              valueLabel="canjes"
              empty="Aún sin canjes cruzados en este periodo."
            />
          </section>
        </>
      )}
      </>
      )}
    </main>
  );
}

// ---------- Helpers de fetch para los paneles admin ----------
// Las cookies de sesión NextAuth viajan automáticamente al ser
// llamadas same-origin; ya no usamos Authorization Bearer.
async function adminFetch(path: string, init?: RequestInit) {
  const r = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) }
  });
  if (r.status === 401) {
    window.location.href = "/login?callbackUrl=/bubui/admin";
    throw new Error("unauthorized");
  }
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

// ---------- Usuarios ----------
function UsersPanel() {
  const [rows, setRows] = useState<any[] | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    adminFetch("/api/bubui/admin/customers").then((d) => setRows(d.customers)).catch((e) => setErr(String(e)));
  }, []);
  if (err) return <p className="text-rose-700 text-sm mt-4">{err}</p>;
  if (!rows) return <div className="bubui-skeleton h-40 mt-4" />;
  return (
    <section className="bubui-card p-4 mt-4 overflow-x-auto">
      <h2 className="text-sm font-bold mb-3">Usuarios ({rows.length})</h2>
      <table className="w-full text-[13px]" style={{ borderCollapse: "collapse" }}>
        <thead>
          <tr>
            {["Nombre", "Teléfono", "Email", "Sexo", "Nacim.", "Ahorrado", "Compras", "Nivel", "Ubicación", "Alta"].map((h) => (
              <th key={h} className="text-left p-2 border-b-2 border-black/10 whitespace-nowrap text-black/55">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.id}>
              <td className="p-2 border-b border-black/5 whitespace-nowrap">{c.name ?? "—"}</td>
              <td className="p-2 border-b border-black/5 whitespace-nowrap">{c.phone ?? "—"}</td>
              <td className="p-2 border-b border-black/5 whitespace-nowrap">{c.email ?? "—"}</td>
              <td className="p-2 border-b border-black/5 whitespace-nowrap">{c.gender ?? "—"}</td>
              <td className="p-2 border-b border-black/5 whitespace-nowrap">{c.birthDate ?? "—"}</td>
              <td className="p-2 border-b border-black/5 whitespace-nowrap">{(c.totalSaved ?? 0).toFixed(2)} €</td>
              <td className="p-2 border-b border-black/5 whitespace-nowrap">{c.totalPurchases}</td>
              <td className="p-2 border-b border-black/5 whitespace-nowrap">{c.ambassadorLevel}</td>
              <td className="p-2 border-b border-black/5 whitespace-nowrap">
                {c.lastLat != null && c.lastLng != null ? (
                  <a href={`https://www.google.com/maps?q=${c.lastLat},${c.lastLng}`} target="_blank" rel="noreferrer" className="text-pink-600">ver</a>
                ) : "—"}
              </td>
              <td className="p-2 border-b border-black/5 whitespace-nowrap">{c.createdAt ? new Date(c.createdAt).toLocaleDateString("es-ES") : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

// ---------- Comercios (con destacar) ----------
function BusinessesPanel() {
  const [rows, setRows] = useState<any[] | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    adminFetch("/api/bubui/admin/businesses").then((d) => setRows(d.businesses)).catch((e) => setErr(String(e)));
  }, []);
  async function toggleFeatured(id: string, featured: boolean) {
    setRows((prev) => prev?.map((b) => (b.id === id ? { ...b, featured } : b)) ?? prev);
    try {
      await adminFetch("/api/bubui/admin/businesses", { method: "PATCH", body: JSON.stringify({ id, featured }) });
    } catch {
      setRows((prev) => prev?.map((b) => (b.id === id ? { ...b, featured: !featured } : b)) ?? prev);
    }
  }
  if (err) return <p className="text-rose-700 text-sm mt-4">{err}</p>;
  if (!rows) return <div className="bubui-skeleton h-40 mt-4" />;
  return (
    <section className="bubui-card p-4 mt-4 overflow-x-auto">
      <h2 className="text-sm font-bold mb-3">Comercios ({rows.length})</h2>
      <table className="w-full text-[13px]" style={{ borderCollapse: "collapse" }}>
        <thead>
          <tr>
            {["Destacar", "Nombre", "Categoría", "Ciudad", "Dueño", "Teléfono", "Plan", "Ofertas", "Compras", "Activo", "Ubicación"].map((h) => (
              <th key={h} className="text-left p-2 border-b-2 border-black/10 whitespace-nowrap text-black/55">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((b) => (
            <tr key={b.id}>
              <td className="p-2 border-b border-black/5 text-center">
                <input type="checkbox" checked={!!b.featured} onChange={(e) => toggleFeatured(b.id, e.target.checked)} />
              </td>
              <td className="p-2 border-b border-black/5 whitespace-nowrap font-semibold">{b.name}{b.featured ? " ⭐" : ""}</td>
              <td className="p-2 border-b border-black/5 whitespace-nowrap">{b.category}</td>
              <td className="p-2 border-b border-black/5 whitespace-nowrap">{b.city ?? "—"}</td>
              <td className="p-2 border-b border-black/5 whitespace-nowrap">{b.ownerName ?? "—"}</td>
              <td className="p-2 border-b border-black/5 whitespace-nowrap">{b.ownerPhone ?? "—"}</td>
              <td className="p-2 border-b border-black/5 whitespace-nowrap">{b.plan}</td>
              <td className="p-2 border-b border-black/5 whitespace-nowrap">{b._count?.offers ?? 0}</td>
              <td className="p-2 border-b border-black/5 whitespace-nowrap">{b._count?.purchases ?? 0}</td>
              <td className="p-2 border-b border-black/5 whitespace-nowrap">{b.active ? "Sí" : "No"}</td>
              <td className="p-2 border-b border-black/5 whitespace-nowrap">
                {b.latitude != null && b.longitude != null ? (
                  <a href={`https://www.google.com/maps?q=${b.latitude},${b.longitude}`} target="_blank" rel="noreferrer" className="text-pink-600">ver</a>
                ) : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

// ---------- Banner del Home ----------
function BannerPanel() {
  const [b, setB] = useState<{ imageUrl: string; link: string; active: boolean }>({ imageUrl: "", link: "", active: false });
  const [msg, setMsg] = useState("");
  useEffect(() => {
    adminFetch("/api/bubui/admin/banner").then(setB).catch(() => {});
  }, []);
  async function save() {
    setMsg("");
    try {
      const saved = await adminFetch("/api/bubui/admin/banner", { method: "PUT", body: JSON.stringify(b) });
      setB(saved);
      setMsg("Guardado ✓");
    } catch (e) {
      setMsg("Error: " + String(e));
    }
  }
  return (
    <section className="bubui-card p-5 mt-4 max-w-xl">
      <h2 className="text-sm font-bold mb-2">Banner del Home</h2>
      <p className="text-[13px] text-black/55 mb-3">
        Imagen promocional grande de la pantalla de inicio. Pega la URL pública de una imagen. Si lo desactivas o dejas
        la URL vacía, la app usa su banner por defecto.
      </p>
      <label className="text-xs font-bold uppercase tracking-wide text-black/55">URL de la imagen</label>
      <input className="bubui-input mb-3 mt-1" value={b.imageUrl} onChange={(e) => setB({ ...b, imageUrl: e.target.value })} placeholder="https://…/banner.png" />
      <label className="text-xs font-bold uppercase tracking-wide text-black/55">Enlace al tocar (opcional)</label>
      <input className="bubui-input mb-3 mt-1" value={b.link} onChange={(e) => setB({ ...b, link: e.target.value })} placeholder="https://…" />
      <label className="flex items-center gap-2 text-sm mb-3">
        <input type="checkbox" checked={b.active} onChange={(e) => setB({ ...b, active: e.target.checked })} />
        Banner activo
      </label>
      {b.imageUrl ? <img src={b.imageUrl} alt="preview" className="rounded-xl max-w-[320px] w-full mb-3 border border-black/10" /> : null}
      <div className="flex items-center gap-3">
        <button onClick={save} className="bubui-btn">Guardar</button>
        {msg && <span className="text-sm">{msg}</span>}
      </div>
    </section>
  );
}

// ---------- Push promocional ----------
function PushPanel() {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  async function send() {
    if (!title.trim() || !body.trim()) { setMsg("Pon título y mensaje."); return; }
    if (!confirm("¿Enviar esta notificación a todos los usuarios suscritos?")) return;
    setBusy(true);
    setMsg("");
    try {
      const r = await adminFetch("/api/bubui/admin/push", { method: "POST", body: JSON.stringify({ title, body, link }) });
      setMsg(`Enviado a ${r.recipients} usuarios (${r.sent} dispositivos).`);
      setTitle(""); setBody(""); setLink("");
    } catch (e) {
      setMsg("Error: " + String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="bubui-card p-5 mt-4 max-w-xl">
      <h2 className="text-sm font-bold mb-2">Notificación push promocional</h2>
      <p className="text-[13px] text-black/55 mb-3">
        Se envía a todos los usuarios que tengan las notificaciones activadas en la app.
      </p>
      <label className="text-xs font-bold uppercase tracking-wide text-black/55">Título</label>
      <input className="bubui-input mb-3 mt-1" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ej: ¡Ofertas nuevas cerca de ti!" maxLength={120} />
      <label className="text-xs font-bold uppercase tracking-wide text-black/55">Mensaje</label>
      <textarea className="bubui-input mb-3 mt-1" value={body} onChange={(e) => setBody(e.target.value)} placeholder="Cuerpo de la notificación" maxLength={300} rows={3} />
      <label className="text-xs font-bold uppercase tracking-wide text-black/55">Enlace al tocar (opcional)</label>
      <input className="bubui-input mb-3 mt-1" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://…" />
      <div className="flex items-center gap-3">
        <button onClick={send} disabled={busy} className="bubui-btn" style={busy ? { opacity: 0.5 } : undefined}>
          {busy ? "Enviando…" : "Enviar a todos"}
        </button>
        {msg && <span className="text-sm">{msg}</span>}
      </div>
    </section>
  );
}

function RankTable({
  rows,
  valueLabel,
  empty
}: {
  rows: Array<{ business: any; extra: string; value: number }>;
  valueLabel: string;
  empty: string;
}) {
  if (rows.length === 0) {
    return <div className="py-6 text-center text-sm text-black/50">{empty}</div>;
  }
  return (
    <div className="bubui-table">
      {rows.map((r, i) => (
        <div key={r.business.id} className="row">
          <div className="left min-w-0">
            <div className="avatar">{i + 1}</div>
            <div className="min-w-0">
              <a
                href={`/bubui/n/${r.business.slug ?? r.business.id}`}
                className="name truncate hover:text-pink-600"
              >
                {r.business.name}
              </a>
              <div className="sub truncate">{r.business.category} · {r.extra}</div>
            </div>
          </div>
          <div className="text-right">
            <div className="amount">{r.value}</div>
            <div className="sub">{valueLabel}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-xl bg-pink-50/60 border border-pink-100 p-2.5 text-center">
      <div className="text-[10px] uppercase tracking-wide text-black/55 font-bold">{label}</div>
      <div className="text-lg font-black mt-0.5">{value}</div>
    </div>
  );
}
