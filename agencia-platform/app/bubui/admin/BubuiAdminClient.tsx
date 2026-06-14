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

type AdminTab = "overview" | "users" | "businesses" | "banner" | "plus" | "push" | "sections";

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
          ["plus", "Plus"],
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
      {tab === "plus" && (
        <>
          <PlusConfigPanel />
          <PlusGiftsPanel />
        </>
      )}
      {tab === "push" && <PushPanel />}
      {tab === "sections" && (
        <>
          <SectionsPanel />
          <AnunciateButtonPanel />
          <AiBannerPolicyPanel />
          <QrPosterPanel />
          <TeamNotifyPanel />
        </>
      )}

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
                <a
                  href={`/api/bubui/business/${b.id}/poster.png`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[12px] font-bold border-2 border-pink-600 text-pink-700 rounded-full px-3 py-1 hover:bg-pink-50"
                >
                  🖨️ Imprimir cartel
                </a>
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
            {["Destacar", "Nombre", "Categoría", "Ciudad", "Dueño", "Teléfono", "Plan", "Ofertas", "Compras", "Activo", "Ubicación", "Cartel"].map((h) => (
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
              <td className="p-2 border-b border-black/5 whitespace-nowrap">
                <a href={`/api/bubui/business/${b.id}/poster.png`} target="_blank" rel="noreferrer" className="text-pink-600" title="Imprimir cartel QR">🖨️</a>
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

// ── Bubui Plus: acceso anticipado ───────────────────────────────────────────
function PlusConfigPanel() {
  const [hours, setHours] = useState("0");
  const [msg, setMsg] = useState("");

  useEffect(() => {
    adminFetch("/api/bubui/admin/plus-config")
      .then((d) => setHours(String(d.earlyAccessHours ?? 0)))
      .catch(() => {});
  }, []);

  async function save() {
    setMsg("");
    try {
      const d = await adminFetch("/api/bubui/admin/plus-config", {
        method: "PUT",
        body: JSON.stringify({ earlyAccessHours: Math.max(0, parseInt(hours || "0", 10) || 0) })
      });
      setHours(String(d.earlyAccessHours ?? 0));
      setMsg("Guardado ✓");
    } catch (e) {
      setMsg("Error: " + String(e));
    }
  }

  return (
    <section className="bubui-card p-5 mt-4 max-w-xl">
      <h2 className="text-sm font-bold mb-2">Acceso anticipado (Plus)</h2>
      <p className="text-[13px] text-black/55 mb-3">
        Horas que los suscriptores Plus ven cada oferta <strong>antes</strong> que el resto. Los usuarios sin Plus verán
        cada oferta solo cuando pasen estas horas desde que se generó. <strong>0 = desactivado</strong> (todos las ven al
        instante, como ahora).
      </p>
      <label className="text-xs font-bold uppercase tracking-wide text-black/55">Ventana de adelanto (horas)</label>
      <input
        className="bubui-input mb-3 mt-1 max-w-[160px]"
        inputMode="numeric"
        value={hours}
        onChange={(e) => setHours(e.target.value.replace(/[^0-9]/g, ""))}
        placeholder="0"
      />
      <div className="flex items-center gap-3">
        <button onClick={save} className="bubui-btn">Guardar</button>
        {msg && <span className="text-sm">{msg}</span>}
      </div>
    </section>
  );
}

// ── Bubui Plus: catálogo de regalos exclusivos ──────────────────────────────
type AdminGift = { id: string; title: string; description: string | null; imageUrl: string | null; link: string | null; order: number; active: boolean };

function PlusGiftsPanel() {
  const [gifts, setGifts] = useState<AdminGift[] | null>(null);
  const [err, setErr] = useState("");
  const [form, setForm] = useState<{ title: string; description: string; imageUrl: string; link: string; order: string }>(
    { title: "", description: "", imageUrl: "", link: "", order: "0" }
  );
  const [saving, setSaving] = useState(false);

  function load() {
    adminFetch("/api/bubui/admin/plus-gifts").then((d) => setGifts(d.gifts)).catch((e) => setErr(String(e)));
  }
  useEffect(load, []);

  async function add() {
    if (!form.title.trim()) return;
    setSaving(true);
    setErr("");
    try {
      await adminFetch("/api/bubui/admin/plus-gifts", {
        method: "POST",
        body: JSON.stringify({
          title: form.title.trim(),
          description: form.description.trim() || undefined,
          imageUrl: form.imageUrl.trim() || undefined,
          link: form.link.trim() || undefined,
          order: parseInt(form.order || "0", 10) || 0
        })
      });
      setForm({ title: "", description: "", imageUrl: "", link: "", order: "0" });
      load();
    } catch (e) {
      setErr(String(e));
    } finally {
      setSaving(false);
    }
  }

  async function toggle(g: AdminGift) {
    try {
      await adminFetch("/api/bubui/admin/plus-gifts", { method: "PATCH", body: JSON.stringify({ id: g.id, active: !g.active }) });
      load();
    } catch (e) {
      setErr(String(e));
    }
  }

  async function remove(g: AdminGift) {
    if (!confirm(`¿Eliminar "${g.title}"?`)) return;
    try {
      await adminFetch(`/api/bubui/admin/plus-gifts?id=${encodeURIComponent(g.id)}`, { method: "DELETE" });
      load();
    } catch (e) {
      setErr(String(e));
    }
  }

  return (
    <section className="bubui-card p-5 mt-4 max-w-xl">
      <h2 className="text-sm font-bold mb-2">Regalos Plus</h2>
      <p className="text-[13px] text-black/55 mb-3">
        Regalos exclusivos que solo ven en la app los suscriptores de Bubui Plus. Aparecen ordenados por el número de
        orden (menor primero).
      </p>

      <div className="grid gap-2 mb-3">
        <input className="bubui-input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Título del regalo *" />
        <input className="bubui-input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Descripción (opcional)" />
        <input className="bubui-input" value={form.imageUrl} onChange={(e) => setForm({ ...form, imageUrl: e.target.value })} placeholder="URL de imagen (opcional)" />
        <input className="bubui-input" value={form.link} onChange={(e) => setForm({ ...form, link: e.target.value })} placeholder="Enlace al tocar (opcional)" />
        <input className="bubui-input max-w-[120px]" inputMode="numeric" value={form.order} onChange={(e) => setForm({ ...form, order: e.target.value.replace(/[^0-9]/g, "") })} placeholder="Orden" />
        <button onClick={add} disabled={saving || !form.title.trim()} className="bubui-btn disabled:opacity-50 w-fit">
          {saving ? "Añadiendo…" : "Añadir regalo"}
        </button>
      </div>

      {err && <div className="text-rose-700 text-sm mb-2">{err}</div>}

      {gifts == null ? (
        <div className="bubui-skeleton h-16" />
      ) : gifts.length === 0 ? (
        <p className="text-sm text-black/45">Todavía no hay regalos.</p>
      ) : (
        <ul className="divide-y divide-black/5">
          {gifts.map((g) => (
            <li key={g.id} className="py-2 flex items-center gap-3">
              {g.imageUrl ? <img src={g.imageUrl} alt="" className="h-10 w-10 rounded-lg object-cover border border-black/10" /> : <div className="h-10 w-10 rounded-lg bg-black/5 flex items-center justify-center">🎁</div>}
              <div className="flex-1 min-w-0">
                <div className="text-sm font-bold truncate">{g.title}</div>
                {g.description && <div className="text-[12px] text-black/50 truncate">{g.description}</div>}
                <div className="text-[11px] text-black/40">orden {g.order}{g.active ? "" : " · oculto"}</div>
              </div>
              <button onClick={() => toggle(g)} className="bubui-chip" style={{ cursor: "pointer" }}>{g.active ? "Ocultar" : "Activar"}</button>
              <button onClick={() => remove(g)} className="text-rose-600 text-sm font-semibold">Eliminar</button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ---------- Push promocional ----------
function ageFromBirth(birthDate?: string | null): number | null {
  if (!birthDate) return null;
  const d = new Date(birthDate);
  if (isNaN(d.getTime())) return null;
  const now = new Date();
  let a = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) a--;
  return a;
}

function PushPanel() {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [link, setLink] = useState("");
  const [image, setImage] = useState("");
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [stats, setStats] = useState<{
    web: { enabled: boolean; devices: number; customers: number };
    mobile: { enabled: boolean; devices: number; customers: number; android: number; ios: number };
    totalUniqueCustomers: number;
  } | null>(null);
  const [users, setUsers] = useState<any[] | null>(null);

  // Audiencia: todos | por filtros | elegir usuarios.
  const [mode, setMode] = useState<"all" | "filter" | "pick">("all");
  const [fGender, setFGender] = useState("");
  const [fAgeMin, setFAgeMin] = useState("");
  const [fAgeMax, setFAgeMax] = useState("");
  const [fPostal, setFPostal] = useState("");
  const [fCats, setFCats] = useState<string[]>([]);
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [search, setSearch] = useState("");

  useEffect(() => {
    adminFetch("/api/bubui/admin/push/stats").then(setStats).catch(() => {});
    adminFetch("/api/bubui/admin/customers").then((d) => setUsers(d.customers)).catch(() => {});
  }, []);

  async function onPickImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) e.target.value = ""; // permite re-subir el mismo archivo
    if (!file) return;
    setMsg("");
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      // Reutilizamos el endpoint de subida del banner (devuelve URL pública).
      const r = await fetch("/api/bubui/admin/banner/upload", { method: "POST", body: fd });
      if (r.status === 401) {
        window.location.href = "/login?callbackUrl=/bubui/admin";
        return;
      }
      const j: any = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.error?.message || j?.error?.code || `HTTP ${r.status}`);
      setImage(j.url);
      setMsg("Imagen lista ✓");
    } catch (err) {
      setMsg("Error al subir: " + String(err));
    } finally {
      setUploading(false);
    }
  }

  const allCats = Array.from(new Set((users ?? []).flatMap((u) => u.categories ?? []))).sort();
  const postalList = fPostal.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);

  function matches(u: any): boolean {
    if (fGender && u.gender !== fGender) return false;
    const age = ageFromBirth(u.birthDate);
    if (fAgeMin && (age == null || age < Number(fAgeMin))) return false;
    if (fAgeMax && (age == null || age > Number(fAgeMax))) return false;
    if (postalList.length && !postalList.includes(u.postalCode)) return false;
    if (fCats.length && !((u.categories ?? []) as string[]).some((c) => fCats.includes(c))) return false;
    return true;
  }

  const filteredUsers = (users ?? []).filter(matches);
  const audienceIds: string[] | null =
    mode === "all"
      ? null
      : mode === "filter"
        ? filteredUsers.map((u) => u.id)
        : Object.keys(picked).filter((k) => picked[k]);
  const audienceCount = mode === "all" ? stats?.totalUniqueCustomers ?? null : audienceIds?.length ?? 0;

  // Lista para "elegir usuarios" (con búsqueda por nombre/email/teléfono/CP).
  const q = search.trim().toLowerCase();
  const pickList = (users ?? []).filter(
    (u) => !q || [u.name, u.email, u.phone, u.postalCode].some((v) => (v ?? "").toLowerCase().includes(q))
  );

  function toggleCat(cat: string) {
    setFCats((prev) => (prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat]));
  }

  async function send() {
    if (!title.trim() || !body.trim()) { setMsg("Pon título y mensaje."); return; }
    if (mode !== "all" && (!audienceIds || audienceIds.length === 0)) {
      setMsg("No hay destinatarios con esos criterios.");
      return;
    }
    const target = mode === "all" ? "TODOS los suscritos" : `${audienceIds!.length} usuario(s) seleccionados`;
    if (!confirm(`¿Enviar esta notificación a ${target}?`)) return;
    setBusy(true);
    setMsg("");
    try {
      const payload: any = { title, body, link, image };
      if (mode !== "all" && audienceIds) payload.customerIds = audienceIds;
      const r = await adminFetch("/api/bubui/admin/push", { method: "POST", body: JSON.stringify(payload) });
      const w = r?.channels?.web;
      const m = r?.channels?.mobile;
      const parts: string[] = [];
      if (w) parts.push(`Web ${w.sent}/${w.recipients}`);
      if (m) parts.push(`Móvil ${m.sent}/${m.recipients}`);
      setMsg(`Enviado · ${parts.join(" · ")}${r.removed ? ` · ${r.removed} muertos limpiados` : ""}`);
      setTitle(""); setBody(""); setLink(""); setImage("");
      // refresca stats
      adminFetch("/api/bubui/admin/push/stats").then(setStats).catch(() => {});
    } catch (e) {
      setMsg("Error: " + String(e));
    } finally {
      setBusy(false);
    }
  }

  const tabBtn = (k: "all" | "filter" | "pick", label: string) => (
    <button
      type="button"
      onClick={() => setMode(k)}
      className="px-3 py-1.5 rounded-full text-[13px] font-semibold"
      style={mode === k ? { background: "#ec1c6e", color: "#fff" } : { background: "#f1f5f9", color: "#334155", cursor: "pointer" }}
    >
      {label}
    </button>
  );

  return (
    <section className="bubui-card p-5 mt-4 max-w-xl">
      <h2 className="text-sm font-bold mb-2">Notificación push promocional</h2>
      <p className="text-[13px] text-black/55 mb-3">
        Elige a quién le llega: a todos, por filtros (CP, edad, sexo, gustos) o eligiendo usuarios. Las push
        llegan aunque tengan la app cerrada.
      </p>
      {stats && (
        <div className="flex flex-wrap items-center gap-2 mb-3 text-[11px]">
          <span className="bubui-chip" style={{ cursor: "default" }}>Web · {stats.web.customers} · {stats.web.devices} disp.</span>
          <span className="bubui-chip" style={{ cursor: "default" }}>Móvil · {stats.mobile.customers} · {stats.mobile.android} And / {stats.mobile.ios} iOS</span>
          <span className="bubui-chip" style={{ background: "#FCE7F3", color: "#9D174D", cursor: "default" }}>Total únicos · {stats.totalUniqueCustomers}</span>
        </div>
      )}

      {/* Selector de audiencia */}
      <div className="flex items-center gap-2 mb-3">
        {tabBtn("all", "Todos")}
        {tabBtn("filter", "Por filtros")}
        {tabBtn("pick", "Elegir usuarios")}
      </div>

      {mode === "filter" && (
        <div className="rounded-xl border border-black/10 p-3 mb-3 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <label className="text-[12px] text-black/55">Sexo
              <select className="bubui-input mt-1" value={fGender} onChange={(e) => setFGender(e.target.value)}>
                <option value="">Cualquiera</option>
                <option value="female">Mujer</option>
                <option value="male">Hombre</option>
                <option value="other">Otro</option>
                <option value="prefer_not">Sin especificar</option>
              </select>
            </label>
            <label className="text-[12px] text-black/55">Código postal (uno o varios)
              <input className="bubui-input mt-1" value={fPostal} onChange={(e) => setFPostal(e.target.value)} placeholder="Ej: 28001, 28013" />
            </label>
            <label className="text-[12px] text-black/55">Edad mín.
              <input className="bubui-input mt-1" inputMode="numeric" value={fAgeMin} onChange={(e) => setFAgeMin(e.target.value.replace(/[^0-9]/g, ""))} placeholder="18" />
            </label>
            <label className="text-[12px] text-black/55">Edad máx.
              <input className="bubui-input mt-1" inputMode="numeric" value={fAgeMax} onChange={(e) => setFAgeMax(e.target.value.replace(/[^0-9]/g, ""))} placeholder="65" />
            </label>
          </div>
          <div>
            <div className="text-[12px] text-black/55 mb-1">Gustos (categorías donde han comprado)</div>
            {allCats.length === 0 ? (
              <div className="text-[12px] text-black/40">Aún no hay compras para deducir gustos.</div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {allCats.map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => toggleCat(cat)}
                    className="px-2 py-0.5 rounded-full text-[12px]"
                    style={fCats.includes(cat) ? { background: "#ec1c6e", color: "#fff" } : { background: "#f1f5f9", color: "#334155", cursor: "pointer" }}
                  >
                    {cat}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {mode === "pick" && (
        <div className="rounded-xl border border-black/10 p-3 mb-3">
          <input className="bubui-input mb-2" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por nombre, email, teléfono o CP…" />
          <div className="flex items-center justify-between text-[12px] text-black/55 mb-2">
            <span>{Object.values(picked).filter(Boolean).length} seleccionados</span>
            <div className="flex gap-3">
              <button type="button" className="text-pink-600" onClick={() => setPicked(Object.fromEntries(pickList.map((u) => [u.id, true])))}>Marcar visibles</button>
              <button type="button" className="text-black/50" onClick={() => setPicked({})}>Limpiar</button>
            </div>
          </div>
          <div className="max-h-64 overflow-y-auto divide-y divide-black/5">
            {!users ? (
              <div className="py-3 text-[12px] text-black/40">Cargando usuarios…</div>
            ) : pickList.map((u) => (
              <label key={u.id} className="flex items-center gap-2 py-1.5 text-[13px] cursor-pointer">
                <input type="checkbox" checked={!!picked[u.id]} onChange={(e) => setPicked((p) => ({ ...p, [u.id]: e.target.checked }))} />
                <span className="font-medium">{u.name ?? "—"}</span>
                <span className="text-black/45">{u.postalCode ? `· ${u.postalCode}` : ""} {u.phone ? `· ${u.phone}` : ""}</span>
              </label>
            ))}
          </div>
        </div>
      )}

      <label className="text-xs font-bold uppercase tracking-wide text-black/55">Título</label>
      <input className="bubui-input mb-3 mt-1" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ej: ¡Ofertas nuevas cerca de ti!" maxLength={120} />
      <label className="text-xs font-bold uppercase tracking-wide text-black/55">Mensaje</label>
      <textarea className="bubui-input mb-3 mt-1" value={body} onChange={(e) => setBody(e.target.value)} placeholder="Cuerpo de la notificación" maxLength={300} rows={3} />
      <label className="text-xs font-bold uppercase tracking-wide text-black/55">Enlace de la oferta al tocar (opcional)</label>
      <input className="bubui-input mb-1 mt-1" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://…/bubui/n/mi-negocio" />
      <p className="text-[11px] text-black/45 mb-3">Al tocar la notificación (o la imagen) se abre este enlace.</p>

      <label className="text-xs font-bold uppercase tracking-wide text-black/55">Imagen (opcional)</label>
      <p className="text-[11px] text-black/45 mt-1 mb-2">Se muestra grande dentro de la notificación. Recomendado horizontal (ej. 1024×512).</p>
      <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" onChange={onPickImage} />
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading} className="bubui-btn disabled:opacity-50">
          {uploading ? "Subiendo…" : "📷 Subir imagen"}
        </button>
        {image && (
          <button type="button" onClick={() => setImage("")} className="text-[12px] text-black/55 underline">
            Quitar
          </button>
        )}
      </div>
      <input className="bubui-input mb-3 mt-1" value={image} onChange={(e) => setImage(e.target.value)} placeholder="https://…/imagen.png" />
      {image ? <img src={image} alt="preview" className="rounded-xl max-w-[320px] w-full mb-3 border border-black/10" /> : null}

      <div className="flex items-center gap-3 flex-wrap">
        <button onClick={send} disabled={busy} className="bubui-btn" style={busy ? { opacity: 0.5 } : undefined}>
          {busy
            ? "Enviando…"
            : mode === "all"
              ? `Enviar a todos${audienceCount != null ? ` (${audienceCount})` : ""}`
              : `Enviar a ${audienceCount ?? 0} usuario(s)`}
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

/** Política de acceso al Banner IA del panel de negocios: abierto a todos
 *  los planes o limitado a Pro/Premium. Cambia al instante, sin deploy. */
function AnunciateButtonPanel() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    adminFetch("/api/bubui/anunciate-button")
      .then((d) => setEnabled(!!d.enabled))
      .catch((e) => setErr(String(e)));
  }, []);

  async function save(next: boolean) {
    setSaving(true);
    setErr("");
    try {
      const d = await adminFetch("/api/bubui/anunciate-button", {
        method: "PATCH",
        body: JSON.stringify({ enabled: next })
      });
      setEnabled(!!d.enabled);
    } catch (e) {
      setErr(String(e));
    } finally {
      setSaving(false);
    }
  }

  if (err) return <p className="text-rose-700 text-sm mt-4">{err}</p>;
  if (enabled === null) return <div className="bubui-skeleton h-24 mt-4" />;

  return (
    <section className="bubui-card p-4 mt-4 space-y-4">
      <div>
        <h2 className="text-sm font-bold">📣 Botón flotante «Anúnciate»</h2>
        <p className="text-xs text-black/50 mt-1">
          CTA fijo y animado que aparece en cualquier pantalla del panel del comercio
          y lleva al formulario de anuncios (Push del Día). Aquí lo enciendes o apagas
          para todos los comercios al instante.
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-pink-50/50 px-3 py-3">
        <div>
          <div className="font-semibold text-sm">Estado</div>
          <div className="text-[12px] text-black/50">
            Actualmente:{" "}
            <b className={enabled ? "text-emerald-600" : "text-amber-600"}>
              {enabled ? "Visible para los comercios" : "Oculto"}
            </b>
          </div>
        </div>
        <div className="flex gap-1.5">
          {(
            [
              { v: true, label: "Encendido" },
              { v: false, label: "Apagado" }
            ]
          ).map((o) => (
            <button
              key={String(o.v)}
              disabled={saving}
              onClick={() => save(o.v)}
              className="px-3 py-1.5 rounded-full text-xs font-bold border disabled:opacity-50"
              style={
                enabled === o.v
                  ? { background: "#ec1c6e", color: "#fff", borderColor: "#ec1c6e" }
                  : { background: "#fff", borderColor: "rgba(0,0,0,0.12)", cursor: "pointer" }
              }
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

function AiBannerPolicyPanel() {
  const [policy, setPolicy] = useState<"all" | "paid" | null>(null);
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    adminFetch("/api/bubui/admin/ai-banner")
      .then((d) => setPolicy(d.policy))
      .catch((e) => setErr(String(e)));
  }, []);

  async function save(next: "all" | "paid") {
    setSaving(true);
    setErr("");
    try {
      const d = await adminFetch("/api/bubui/admin/ai-banner", {
        method: "PATCH",
        body: JSON.stringify({ policy: next })
      });
      setPolicy(d.policy);
    } catch (e) {
      setErr(String(e));
    } finally {
      setSaving(false);
    }
  }

  if (err) return <p className="text-rose-700 text-sm mt-4">{err}</p>;
  if (!policy) return <div className="bubui-skeleton h-24 mt-4" />;

  return (
    <section className="bubui-card p-4 mt-4 space-y-4">
      <div>
        <h2 className="text-sm font-bold">🖼️ Banner IA (panel de negocios)</h2>
        <p className="text-xs text-black/50 mt-1">
          El comercio sube una foto de su escaparate y la IA genera su banner de portada
          (1 gratis, luego 1€/edición). Aquí decides quién puede usarlo.
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-pink-50/50 px-3 py-3">
        <div>
          <div className="font-semibold text-sm">Disponible para</div>
          <div className="text-[12px] text-black/50">
            Estado actual:{" "}
            <b className={policy === "all" ? "text-emerald-600" : "text-amber-600"}>
              {policy === "all" ? "Todos los planes" : "Solo planes de pago (Pro/Premium)"}
            </b>
          </div>
        </div>
        <div className="flex gap-1.5">
          {(
            [
              { v: "all" as const, label: "Todos los planes" },
              { v: "paid" as const, label: "Solo planes de pago" }
            ]
          ).map((o) => (
            <button
              key={o.v}
              disabled={saving}
              onClick={() => save(o.v)}
              className="px-3 py-1.5 rounded-full text-xs font-bold border disabled:opacity-50"
              style={
                policy === o.v
                  ? { background: "#ec1c6e", color: "#fff", borderColor: "#ec1c6e" }
                  : { background: "#fff", borderColor: "rgba(0,0,0,0.12)", cursor: "pointer" }
              }
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

/** Plantilla del cartel QR de marca: el mismo póster para todos los
 *  comercios, con el QR de cada uno compuesto encima. El admin la sube una
 *  vez; cada negocio descarga su cartel listo para imprimir. */
function QrPosterPanel() {
  const [config, setConfig] = useState<{ url: string } | null | undefined>(undefined);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    adminFetch("/api/bubui/admin/qr-poster")
      .then((d) => setConfig(d.config))
      .catch((e) => setErr(String(e)));
  }, []);

  async function uploadTemplate(file: File) {
    setUploading(true);
    setErr("");
    setMsg("");
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetch("/api/bubui/admin/banner/upload", { method: "POST", body: fd });
      if (r.status === 401) {
        window.location.href = "/login?callbackUrl=/bubui/admin";
        return;
      }
      const j: any = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.error?.message || j?.error?.code || `HTTP ${r.status}`);
      const d = await adminFetch("/api/bubui/admin/qr-poster", {
        method: "PATCH",
        body: JSON.stringify({ url: j.url })
      });
      setConfig(d.config);
      setMsg("Plantilla guardada ✓ — los carteles de TODOS los comercios ya la usan.");
    } catch (e) {
      setErr(String(e));
    } finally {
      setUploading(false);
    }
  }

  async function disable() {
    setErr("");
    setMsg("");
    try {
      const d = await adminFetch("/api/bubui/admin/qr-poster", {
        method: "PATCH",
        body: JSON.stringify({ url: null })
      });
      setConfig(d.config);
      setMsg("Plantilla desactivada — vuelve el cartel generado clásico.");
    } catch (e) {
      setErr(String(e));
    }
  }

  if (config === undefined && !err) return <div className="bubui-skeleton h-24 mt-4" />;

  return (
    <section className="bubui-card p-4 mt-4 space-y-3">
      <div>
        <h2 className="text-sm font-bold">🪧 Cartel QR de marca (todos los comercios)</h2>
        <p className="text-xs text-black/50 mt-1">
          Sube la plantilla oficial del cartel (el póster de Bubui con el QR de muestra). El sistema
          colocará automáticamente el <b>QR real de cada comercio</b> sobre la tarjeta blanca: cada
          negocio descarga su cartel listo para imprimir desde su panel, y tú puedes imprimirlo desde
          aquí cuando te pidan llevárselo.
        </p>
      </div>
      {err && <p className="text-rose-700 text-xs">{err}</p>}
      {msg && <p className="text-emerald-700 text-xs font-semibold">{msg}</p>}
      <div className="flex items-center gap-2 flex-wrap">
        <label className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-bold cursor-pointer ${uploading ? "bg-pink-200 text-pink-500" : "bg-pink-600 text-white hover:bg-pink-700"}`}>
          {uploading ? "Subiendo…" : config ? "📤 Sustituir plantilla" : "📤 Subir plantilla"}
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            disabled={uploading}
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void uploadTemplate(f);
            }}
          />
        </label>
        {config && (
          <button onClick={disable} className="text-xs text-black/50 hover:text-rose-600 underline">
            Desactivar plantilla
          </button>
        )}
      </div>
      {config && (
        <div className="flex items-start gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={config.url} alt="Plantilla del cartel" className="w-36 rounded-lg border" />
          <p className="text-[11px] text-black/45">
            Estado: <b className="text-emerald-600">activa</b>. El QR de cada negocio se coloca sobre
            la tarjeta blanca de la plantilla. Para imprimir el cartel de un comercio concreto, usa el
            botón 🖨️ de su fila en la pestaña <b>Comercios</b>.
          </p>
        </div>
      )}
    </section>
  );
}

/** Destinos de las notificaciones internas del equipo (solicitudes de
 *  cartel, etc.): varios emails + un WhatsApp, editables sin deploy. */
function TeamNotifyPanel() {
  const [emails, setEmails] = useState<string[] | null>(null);
  const [whatsapp, setWhatsapp] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    adminFetch("/api/bubui/admin/notifications")
      .then((d) => {
        setEmails(d.config.emails);
        setWhatsapp(d.config.whatsapp ?? "");
      })
      .catch((e) => setErr(String(e)));
  }, []);

  async function save(nextEmails: string[], nextWhatsapp: string) {
    setSaving(true);
    setErr("");
    setMsg("");
    try {
      const d = await adminFetch("/api/bubui/admin/notifications", {
        method: "PATCH",
        body: JSON.stringify({ emails: nextEmails, whatsapp: nextWhatsapp.trim() || null })
      });
      setEmails(d.config.emails);
      setWhatsapp(d.config.whatsapp ?? "");
      setMsg("Guardado ✓");
    } catch (e) {
      setErr(String(e));
    } finally {
      setSaving(false);
    }
  }

  function addEmail() {
    const e = newEmail.trim();
    if (!/.+@.+\..+/.test(e)) { setErr("Email no válido."); return; }
    if (emails?.includes(e)) { setNewEmail(""); return; }
    const next = [...(emails ?? []), e];
    setNewEmail("");
    void save(next, whatsapp);
  }

  function removeEmail(e: string) {
    const next = (emails ?? []).filter((x) => x !== e);
    if (next.length === 0) { setErr("Debe quedar al menos un email."); return; }
    void save(next, whatsapp);
  }

  async function sendTest() {
    setTesting(true);
    setErr("");
    setMsg("");
    try {
      const d = await adminFetch("/api/bubui/admin/notifications", { method: "POST" });
      setMsg(`Prueba enviada: ${d.result.email} email(s)${d.result.whatsapp ? " + WhatsApp ✓" : " (WhatsApp no salió)"}`);
    } catch (e) {
      setErr(String(e));
    } finally {
      setTesting(false);
    }
  }

  if (emails === null && !err) return <div className="bubui-skeleton h-32 mt-4" />;

  return (
    <section className="bubui-card p-4 mt-4 space-y-3">
      <div>
        <h2 className="text-sm font-bold">🔔 Notificaciones del equipo</h2>
        <p className="text-xs text-black/50 mt-1">
          A dónde llegan los avisos internos (solicitudes de cartel QR, etc.). Puedes añadir varios
          emails y un número de WhatsApp.
        </p>
      </div>
      {err && <p className="text-rose-700 text-xs">{err}</p>}
      {msg && <p className="text-emerald-700 text-xs font-semibold">{msg}</p>}

      <div className="space-y-1.5">
        <p className="text-xs font-semibold">Emails</p>
        {(emails ?? []).map((e) => (
          <div key={e} className="flex items-center justify-between gap-2 rounded-lg bg-pink-50/50 px-3 py-1.5">
            <span className="text-[13px]">{e}</span>
            <button onClick={() => removeEmail(e)} disabled={saving} className="text-xs text-black/40 hover:text-rose-600">
              Quitar
            </button>
          </div>
        ))}
        <div className="flex gap-2">
          <input
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") addEmail(); }}
            placeholder="otro@email.com"
            className="flex-1 px-2 py-1.5 border rounded bg-white text-sm"
          />
          <button onClick={addEmail} disabled={saving} className="px-3 py-1.5 rounded-full text-xs font-bold bg-pink-600 text-white hover:bg-pink-700 disabled:opacity-50">
            Añadir
          </button>
        </div>
      </div>

      <div className="space-y-1.5">
        <p className="text-xs font-semibold">WhatsApp (vía tu sesión de WhatsApp del Hub)</p>
        <div className="flex gap-2">
          <input
            value={whatsapp}
            onChange={(e) => setWhatsapp(e.target.value)}
            placeholder="680167881"
            className="flex-1 px-2 py-1.5 border rounded bg-white text-sm"
          />
          <button
            onClick={() => void save(emails ?? [], whatsapp)}
            disabled={saving}
            className="px-3 py-1.5 rounded-full text-xs font-bold bg-pink-600 text-white hover:bg-pink-700 disabled:opacity-50"
          >
            {saving ? "Guardando…" : "Guardar"}
          </button>
        </div>
      </div>

      <button onClick={sendTest} disabled={testing} className="text-xs font-bold border-2 border-pink-600 text-pink-700 rounded-full px-3 py-1.5 hover:bg-pink-50 disabled:opacity-50">
        {testing ? "Enviando…" : "📨 Enviar notificación de prueba"}
      </button>
    </section>
  );
}
