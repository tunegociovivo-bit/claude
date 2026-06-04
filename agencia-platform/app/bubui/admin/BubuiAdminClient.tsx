"use client";

import { useEffect, useRef, useState } from "react";
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
  appVersions: Array<{ build: string | null; count: number }>;
};

type AdminTab = "overview" | "users" | "businesses" | "banner" | "push" | "sections";

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
          ["push", "Push"],
          ["sections", "Secciones"]
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
      {tab === "sections" && <SectionsPanel />}

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
            {data.appVersions?.length > 0 && (() => {
              const nums = data.appVersions.map((v) => (v.build ? Number(v.build) : null)).filter((n): n is number => n != null && !Number.isNaN(n));
              const latest = nums.length ? Math.max(...nums) : null;
              return (
                <div className="mt-3 pt-3 border-t border-black/5 flex items-center gap-2 flex-wrap">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-black/45">Versiones app:</span>
                  {data.appVersions.map((v) => {
                    const isOld = v.build != null && latest != null && Number(v.build) < latest;
                    const bg = v.build == null ? "#f1f5f9" : isOld ? "#fef3c7" : "#dcfce7";
                    return (
                      <span key={v.build ?? "none"} className="px-2 py-0.5 rounded-full text-[12px] whitespace-nowrap" style={{ background: bg, cursor: "default" }}>
                        {v.build == null ? "sin reportar" : `build ${v.build}`} · {v.count}
                        {v.build != null && latest != null && Number(v.build) === latest ? " ✓" : ""}
                      </span>
                    );
                  })}
                </div>
              );
            })()}
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
    throw new Error("Sesión caducada — vuelve a iniciar sesión.");
  }
  if (!r.ok) {
    // Lee el cuerpo de error para dar un mensaje útil en la UI.
    let detail = "";
    try {
      const j: any = await r.clone().json();
      detail = j?.error?.message || j?.error?.code || j?.message || "";
    } catch {
      try { detail = (await r.clone().text()).slice(0, 200); } catch {}
    }
    throw new Error(`HTTP ${r.status}${detail ? " · " + detail : ""}`);
  }
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

  // Versiones instaladas: distribución + cuál es la más reciente (para avisar
  // de los que van por detrás al hacer pruebas).
  const builds = rows
    .map((c) => (c.appBuild ? parseInt(c.appBuild, 10) : null))
    .filter((n): n is number => n != null && !Number.isNaN(n));
  const latestBuild = builds.length ? Math.max(...builds) : null;
  const dist = new Map<string, number>();
  for (const c of rows) {
    const k = c.appBuild ? String(c.appBuild) : "sin reportar";
    dist.set(k, (dist.get(k) ?? 0) + 1);
  }
  const distSorted = [...dist.entries()].sort((a, b) => {
    if (a[0] === "sin reportar") return 1;
    if (b[0] === "sin reportar") return -1;
    return Number(b[0]) - Number(a[0]);
  });

  return (
    <section className="bubui-card p-4 mt-4 overflow-x-auto">
      <h2 className="text-sm font-bold mb-3">Usuarios ({rows.length})</h2>
      <div className="flex flex-wrap items-center gap-2 mb-4 text-[12px]">
        <span className="text-black/45">Versiones:</span>
        {distSorted.map(([build, n]) => {
          const isOld = build !== "sin reportar" && latestBuild != null && Number(build) < latestBuild;
          const bg = build === "sin reportar" ? "#f1f5f9" : isOld ? "#fef3c7" : "#dcfce7";
          return (
            <span key={build} className="px-2 py-0.5 rounded-full whitespace-nowrap" style={{ background: bg }}>
              {build === "sin reportar" ? "sin reportar" : `build ${build}`} · {n}
              {build !== "sin reportar" && latestBuild != null && Number(build) === latestBuild ? " ✓" : ""}
            </span>
          );
        })}
      </div>
      <table className="w-full text-[13px]" style={{ borderCollapse: "collapse" }}>
        <thead>
          <tr>
            {["Nombre", "Teléfono", "Email", "Sexo", "Nacim.", "CP", "Ahorrado", "Compras", "Nivel", "Versión", "Ubicación", "Alta"].map((h) => (
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
              <td className="p-2 border-b border-black/5 whitespace-nowrap">{c.postalCode ?? "—"}</td>
              <td className="p-2 border-b border-black/5 whitespace-nowrap">{(c.totalSaved ?? 0).toFixed(2)} €</td>
              <td className="p-2 border-b border-black/5 whitespace-nowrap">{c.totalPurchases}</td>
              <td className="p-2 border-b border-black/5 whitespace-nowrap">{c.ambassadorLevel}</td>
              <td
                className="p-2 border-b border-black/5 whitespace-nowrap"
                title={c.lastSeenAt ? `Última conexión: ${new Date(c.lastSeenAt).toLocaleString("es-ES")}` : "Sin datos de versión todavía"}
              >
                {c.appBuild ? (
                  <span className="font-medium">
                    {c.appBuild}
                    {c.appPlatform ? <span className="text-black/45"> · {c.appPlatform}</span> : null}
                    {latestBuild != null && Number(c.appBuild) < latestBuild ? (
                      <span className="ml-1 px-1.5 py-0.5 rounded text-[11px]" style={{ background: "#fef3c7", color: "#92400e" }}>⚠ vieja</span>
                    ) : null}
                  </span>
                ) : "—"}
              </td>
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
  async function markDelivered(id: string) {
    const now = new Date().toISOString();
    setRows((prev) => prev?.map((b) => (b.id === id ? { ...b, posterDeliveredAt: now } : b)) ?? prev);
    try {
      await adminFetch("/api/bubui/admin/businesses", { method: "PATCH", body: JSON.stringify({ id, posterDelivered: true }) });
    } catch {
      setRows((prev) => prev?.map((b) => (b.id === id ? { ...b, posterDeliveredAt: null } : b)) ?? prev);
    }
  }
  if (err) return <p className="text-rose-700 text-sm mt-4">{err}</p>;
  if (!rows) return <div className="bubui-skeleton h-40 mt-4" />;
  const pendingPosters = rows.filter((b) => b.posterDeliveryRequestedAt && !b.posterDeliveredAt);
  return (
    <>
    {pendingPosters.length > 0 && (
      <section className="bubui-card p-4 mt-4 border-2 border-pink-300">
        <h2 className="text-sm font-bold mb-1">🚚 Carteles por entregar ({pendingPosters.length})</h2>
        <p className="text-xs text-black/50 mb-3">Negocios que han pedido que les llevemos el cartel impreso a su local.</p>
        <div className="space-y-2">
          {pendingPosters.map((b) => (
            <div key={b.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-pink-50 px-3 py-2">
              <div className="min-w-0">
                <p className="font-semibold text-[13px]">{b.name}</p>
                <p className="text-[12px] text-black/60">
                  📍 {b.posterDeliveryAddress ?? b.address ?? "—"}
                  {b.posterDeliveryPhone ? ` · ☎ ${b.posterDeliveryPhone}` : b.ownerPhone ? ` · ☎ ${b.ownerPhone}` : ""}
                </p>
                {b.posterDeliveryNote ? <p className="text-[12px] text-black/50 italic">“{b.posterDeliveryNote}”</p> : null}
              </div>
              <div className="flex items-center gap-2">
                {b.posterDeliveryAddress && (
                  <a
                    href={`https://www.google.com/maps?q=${encodeURIComponent(b.posterDeliveryAddress)}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[12px] text-pink-600 font-semibold"
                  >
                    mapa
                  </a>
                )}
                <button
                  onClick={() => markDelivered(b.id)}
                  className="text-[12px] font-bold bg-pink-600 text-white rounded-full px-3 py-1 hover:bg-pink-700"
                >
                  Marcar entregado
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>
    )}
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
    </>
  );
}

// ---------- Banner del Home ----------
function BannerPanel() {
  const [b, setB] = useState<{ imageUrl: string; link: string; active: boolean }>({ imageUrl: "", link: "", active: false });
  const [msg, setMsg] = useState("");
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
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
  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) e.target.value = ""; // permite re-subir el mismo archivo
    if (!file) return;
    setMsg("");
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      // multipart: NO fijamos Content-Type (el navegador pone el boundary).
      const r = await fetch("/api/bubui/admin/banner/upload", { method: "POST", body: fd });
      if (r.status === 401) {
        window.location.href = "/login?callbackUrl=/bubui/admin";
        return;
      }
      const j: any = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.error?.message || j?.error?.code || `HTTP ${r.status}`);
      // Coloca la URL subida y activa el banner; el usuario solo pulsa Guardar.
      setB((prev) => ({ ...prev, imageUrl: j.url, active: true }));
      setMsg("Imagen subida ✓ — pulsa Guardar para publicarla");
    } catch (err) {
      setMsg("Error al subir: " + String(err));
    } finally {
      setUploading(false);
    }
  }
  return (
    <section className="bubui-card p-5 mt-4 max-w-xl">
      <h2 className="text-sm font-bold mb-2">Banner del Home</h2>
      <p className="text-[13px] text-black/55 mb-3">
        Imagen promocional grande de la pantalla de inicio. Sube una imagen desde tu dispositivo o pega la URL pública de
        una. Si lo desactivas o dejas la URL vacía, la app usa su banner por defecto.
      </p>

      {/* Subir desde el dispositivo */}
      <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" onChange={onPickFile} />
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        disabled={uploading}
        className="bubui-btn mb-3 disabled:opacity-50"
      >
        {uploading ? "Subiendo…" : "📷 Subir imagen"}
      </button>

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
  const [stats, setStats] = useState<{
    web: { enabled: boolean; devices: number; customers: number };
    mobile: { enabled: boolean; devices: number; customers: number; android: number; ios: number };
    totalUniqueCustomers: number;
  } | null>(null);

  useEffect(() => {
    adminFetch("/api/bubui/admin/push/stats").then(setStats).catch(() => {});
  }, []);

  async function send() {
    if (!title.trim() || !body.trim()) { setMsg("Pon título y mensaje."); return; }
    if (!confirm("¿Enviar esta notificación a todos los usuarios suscritos?")) return;
    setBusy(true);
    setMsg("");
    try {
      const r = await adminFetch("/api/bubui/admin/push", { method: "POST", body: JSON.stringify({ title, body, link }) });
      const w = r?.channels?.web;
      const m = r?.channels?.mobile;
      const parts: string[] = [];
      if (w) parts.push(`Web ${w.sent}/${w.recipients}`);
      if (m) parts.push(`Móvil ${m.sent}/${m.recipients}`);
      setMsg(`Enviado · ${parts.join(" · ")}${r.removed ? ` · ${r.removed} muertos limpiados` : ""}`);
      setTitle(""); setBody(""); setLink("");
      // refresca stats
      adminFetch("/api/bubui/admin/push/stats").then(setStats).catch(() => {});
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
        Se envía a todos los usuarios suscritos — web (PWA) y app móvil — en una sola operación.
      </p>
      {stats && (
        <div className="flex flex-wrap items-center gap-2 mb-3 text-[11px]">
          <span className="bubui-chip" style={{ cursor: "default" }}>
            Web · {stats.web.customers} usuarios · {stats.web.devices} disp.
          </span>
          <span className="bubui-chip" style={{ cursor: "default" }}>
            Móvil · {stats.mobile.customers} usuarios · {stats.mobile.android} Android / {stats.mobile.ios} iOS
          </span>
          <span className="bubui-chip" style={{ background: "#FCE7F3", color: "#9D174D", cursor: "default" }}>
            Total únicos · {stats.totalUniqueCustomers}
          </span>
        </div>
      )}
      {stats && stats.totalUniqueCustomers === 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 mb-3 text-[12px] text-amber-900">
          <b>Aún no hay nadie suscrito.</b> Los usuarios de la PWA quedan suscritos al aceptar el permiso de
          notificaciones del navegador. Los usuarios de la app móvil se suscriben al iniciar sesión, pero la
          entrega final en Android requiere que la app esté firmada con un proyecto Firebase
          (google-services.json).
        </div>
      )}
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

type SectionMode = "auto" | "on" | "off";
type SectionsState = {
  businesses: number;
  minBusinesses: number;
  visible: { discover: boolean; mapa: boolean };
  modes: { discover: SectionMode; mapa: SectionMode };
};

/**
 * Panel para forzar la visibilidad de las secciones "gated" (Descubre y Mapa)
 * sin esperar a los N comercios activos. Cada sección: Automático / Mostrar /
 * Ocultar. Los cambios afectan a la app al instante (la app lee /stats).
 */
function SectionsPanel() {
  const [st, setSt] = useState<SectionsState | null>(null);
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    adminFetch("/api/bubui/admin/sections").then(setSt).catch((e) => setErr(String(e)));
  }, []);

  async function setMode(section: "discover" | "mapa", mode: SectionMode) {
    setSaving(section);
    try {
      const updated = await adminFetch("/api/bubui/admin/sections", {
        method: "PATCH",
        body: JSON.stringify({ [section]: mode })
      });
      setSt(updated);
    } catch (e) {
      setErr(String(e));
    } finally {
      setSaving(null);
    }
  }

  if (err) return <p className="text-rose-700 text-sm mt-4">{err}</p>;
  if (!st) return <div className="bubui-skeleton h-40 mt-4" />;

  const rows: { key: "discover" | "mapa"; label: string; emoji: string }[] = [
    { key: "discover", label: "Descubre", emoji: "🧭" },
    { key: "mapa", label: "Mapa", emoji: "🗺️" }
  ];

  return (
    <section className="bubui-card p-4 mt-4 space-y-4">
      <div>
        <h2 className="text-sm font-bold">Secciones de la app</h2>
        <p className="text-xs text-black/50 mt-1">
          Descubre y Mapa se muestran solas al llegar a <b>{st.minBusinesses}</b> comercios activos
          (ahora hay <b>{st.businesses}</b>). Aquí puedes forzar que se vean ya, sin esperar.
        </p>
      </div>

      {rows.map((r) => (
        <div key={r.key} className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-pink-50/50 px-3 py-3">
          <div>
            <div className="font-semibold text-sm">{r.emoji} {r.label}</div>
            <div className="text-[12px] text-black/50">
              Estado actual:{" "}
              <b className={st.visible[r.key] ? "text-emerald-600" : "text-black/60"}>
                {st.visible[r.key] ? "Visible" : "Oculta"}
              </b>
              {st.modes[r.key] === "auto" ? " (automático)" : st.modes[r.key] === "on" ? " (forzada visible)" : " (forzada oculta)"}
            </div>
          </div>
          <div className="flex gap-1.5">
            {(["auto", "on", "off"] as SectionMode[]).map((m) => (
              <button
                key={m}
                disabled={saving === r.key}
                onClick={() => setMode(r.key, m)}
                className="px-3 py-1.5 rounded-full text-xs font-bold border disabled:opacity-50"
                style={
                  st.modes[r.key] === m
                    ? { background: "#ec1c6e", color: "#fff", borderColor: "#ec1c6e" }
                    : { background: "#fff", borderColor: "rgba(0,0,0,0.12)", cursor: "pointer" }
                }
              >
                {m === "auto" ? "Automático" : m === "on" ? "Mostrar" : "Ocultar"}
              </button>
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}
