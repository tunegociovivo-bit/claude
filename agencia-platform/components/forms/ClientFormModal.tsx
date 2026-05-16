"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Modal from "@/components/ui/Modal";
import { Loader2, KeyRound, Info, ListChecks } from "lucide-react";

type ServicioKey =
  | "diseno_web"
  | "seo_web"
  | "seo_ia"
  | "gmb"
  | "sem"
  | "gestion_redes"
  | "campana_redes"
  | "resenas_qr"
  | "comercio_electronico"
  | "mantenimiento"
  | "servidor"
  | "dominio";

const SERVICIOS: { key: ServicioKey; label: string }[] = [
  { key: "diseno_web", label: "Diseño Web" },
  { key: "seo_web", label: "SEO WEB" },
  { key: "seo_ia", label: "SEO IA" },
  { key: "gmb", label: "GMB" },
  { key: "sem", label: "SEM" },
  { key: "gestion_redes", label: "Gestión Redes" },
  { key: "campana_redes", label: "Campaña Redes" },
  { key: "resenas_qr", label: "Reseñas QR" },
  { key: "comercio_electronico", label: "Comercio Electrónico" },
  { key: "mantenimiento", label: "Mantenimiento" },
  { key: "servidor", label: "Servidor" },
  { key: "dominio", label: "Dominio" }
];

type Prioridad = "ALTA" | "NORMAL" | "BAJA";

type ClientPayload = {
  id?: string;
  name: string;
  industry?: string;
  status?: "ACTIVE" | "PAUSED" | "PROSPECT" | "CHURNED";
  contactName?: string;
  email?: string;
  phone?: string;
  mrr?: number;
  notes?: string;
  infoGeneral?: string | null;
  accesos?: string | null;
  servicios?: ServicioKey[];
  kitDigital?: boolean;
  prioridad?: Prioridad;
};

// Estilos por nivel de prioridad. Las clases se usan tanto en el modal
// como en cualquier badge en listados.
export const PRIORIDAD_STYLES: Record<Prioridad, { bg: string; text: string; border: string; dot: string; label: string }> = {
  ALTA: {
    bg: "bg-rose-100",
    text: "text-rose-800",
    border: "border-rose-400",
    dot: "bg-rose-500",
    label: "ALTA"
  },
  NORMAL: {
    bg: "bg-sky-50",
    text: "text-sky-800",
    border: "border-sky-300",
    dot: "bg-sky-500",
    label: "NORMAL"
  },
  BAJA: {
    bg: "bg-emerald-50",
    text: "text-emerald-800",
    border: "border-emerald-300",
    dot: "bg-emerald-500",
    label: "BAJA"
  }
};

const statusOptions = [
  { value: "ACTIVE", label: "Activo" },
  { value: "PAUSED", label: "En pausa" },
  { value: "PROSPECT", label: "Prospecto" },
  { value: "CHURNED", label: "Perdido" }
] as const;

export default function ClientFormModal({
  open,
  onClose,
  client,
  mode = "create"
}: {
  open: boolean;
  onClose: () => void;
  client?: ClientPayload | null;
  mode?: "create" | "edit" | "notes";
}) {
  const router = useRouter();
  const isEdit = mode !== "create";

  const [form, setForm] = useState<ClientPayload>({ name: "", status: "ACTIVE", mrr: 0 });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    // Si estamos editando, traemos el detalle completo del cliente
    // para tener infoGeneral / accesos / servicios / kitDigital (la
    // prop client viene del listado y no incluye estos campos).
    if (isEdit && client?.id) {
      fetch(`/api/v1/clients/${client.id}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((full) => {
          if (full) {
            setForm({
              ...(client ?? { name: "" }),
              ...full,
              servicios: Array.isArray(full.servicios) ? full.servicios : [],
              kitDigital: Boolean(full.kitDigital)
            });
          } else {
            setForm(client ?? { name: "", status: "ACTIVE", mrr: 0 });
          }
        })
        .catch(() => setForm(client ?? { name: "", status: "ACTIVE", mrr: 0 }));
    } else {
      setForm(client ?? { name: "", status: "ACTIVE", mrr: 0 });
    }
  }, [open, client, isEdit]);

  function update<K extends keyof ClientPayload>(key: K, val: ClientPayload[K]) {
    setForm((f) => ({ ...f, [key]: val }));
  }

  function toggleServicio(s: ServicioKey) {
    setForm((f) => {
      const curr = Array.isArray(f.servicios) ? f.servicios : [];
      return {
        ...f,
        servicios: curr.includes(s) ? curr.filter((x) => x !== s) : [...curr, s]
      };
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (mode === "create" && !form.name.trim()) return setError("El nombre es obligatorio");

    setSaving(true);
    const isPatch = isEdit && client?.id;
    const url = isPatch ? `/api/v1/clients/${client!.id}` : "/api/v1/clients";
    const payload: any = {
      name: form.name,
      industry: form.industry || undefined,
      status: form.status,
      contactName: form.contactName || undefined,
      email: form.email || undefined,
      phone: form.phone || undefined,
      mrr: Number(form.mrr ?? 0),
      notes: form.notes || undefined,
      infoGeneral: form.infoGeneral ?? null,
      accesos: form.accesos ?? null,
      servicios: Array.isArray(form.servicios) ? form.servicios : [],
      kitDigital: Boolean(form.kitDigital),
      prioridad: (form.prioridad ?? "NORMAL") as Prioridad
    };
    if (mode === "notes") {
      // sólo enviamos notes
      for (const k of Object.keys(payload)) if (k !== "notes") delete payload[k];
    }

    const r = await fetch(url, {
      method: isPatch ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    setSaving(false);
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      return setError(j.message || `Error ${r.status}`);
    }
    router.refresh();
    onClose();
  }

  const title =
    mode === "create" ? "Nuevo cliente" : mode === "notes" ? "Notas internas" : "Editar cliente";

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="lg"
      footer={
        <>
          <button type="button" onClick={onClose} className="px-3 py-2 rounded-lg text-sm border bg-white hover:bg-slate-50">
            Cancelar
          </button>
          <button
            type="submit"
            form="client-form"
            disabled={saving}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium disabled:opacity-50"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Guardar
          </button>
        </>
      }
    >
      <form id="client-form" onSubmit={handleSubmit} className="space-y-4">
        {mode === "notes" ? (
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Notas internas</label>
            <textarea
              value={form.notes ?? ""}
              onChange={(e) => update("notes", e.target.value)}
              autoFocus
              rows={10}
              className="w-full px-3 py-2 rounded-lg border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              placeholder="Apuntes internos del cliente…"
            />
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="block text-xs font-medium text-slate-700 mb-1">Nombre</label>
                <input
                  value={form.name}
                  onChange={(e) => update("name", e.target.value)}
                  autoFocus
                  className="w-full px-3 py-2 rounded-lg border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Sector</label>
                <input
                  value={form.industry ?? ""}
                  onChange={(e) => update("industry", e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Estado</label>
                <select
                  value={form.status}
                  onChange={(e) => update("status", e.target.value as any)}
                  className="w-full px-3 py-2 rounded-lg border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                >
                  {statusOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Prioridad
                </label>
                {(() => {
                  const p: Prioridad = (form.prioridad ?? "NORMAL") as Prioridad;
                  const st = PRIORIDAD_STYLES[p];
                  return (
                    <div className="flex items-center gap-2">
                      <div className="relative flex-1">
                        <select
                          value={p}
                          onChange={(e) => update("prioridad", e.target.value as Prioridad)}
                          className={
                            "w-full pl-8 pr-3 py-2 rounded-lg border text-sm font-medium focus:outline-none focus:ring-2 focus:ring-brand-500 " +
                            st.bg + " " + st.text + " " + st.border
                          }
                        >
                          <option value="ALTA">🔴 ALTA</option>
                          <option value="NORMAL">🔵 NORMAL</option>
                          <option value="BAJA">🟢 BAJA</option>
                        </select>
                        <span
                          className={"absolute left-2.5 top-1/2 -translate-y-1/2 h-3 w-3 rounded-full " + st.dot}
                        />
                      </div>
                      <span
                        className={
                          "inline-flex items-center gap-1 px-2 py-1 rounded-md border text-[11px] font-bold tracking-wide " +
                          st.bg + " " + st.text + " " + st.border
                        }
                      >
                        <span className={"h-1.5 w-1.5 rounded-full " + st.dot} />
                        {st.label}
                      </span>
                    </div>
                  );
                })()}
                <p className="mt-1 text-[11px] text-slate-500">
                  Por defecto NORMAL. Usa ALTA para clientes que requieren atención inmediata — destacarán en rojo en el listado.
                </p>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Persona de contacto</label>
                <input
                  value={form.contactName ?? ""}
                  onChange={(e) => update("contactName", e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">MRR (€)</label>
                <input
                  type="number"
                  min={0}
                  value={form.mrr ?? 0}
                  onChange={(e) => update("mrr", Number(e.target.value))}
                  className="w-full px-3 py-2 rounded-lg border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Email</label>
                <input
                  type="email"
                  value={form.email ?? ""}
                  onChange={(e) => update("email", e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Teléfono</label>
                <input
                  value={form.phone ?? ""}
                  onChange={(e) => update("phone", e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Notas</label>
              <textarea
                value={form.notes ?? ""}
                onChange={(e) => update("notes", e.target.value)}
                rows={3}
                className="w-full px-3 py-2 rounded-lg border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            </div>

            {/* Información General — texto libre con datos extra del
                cliente: ubicación, horarios, sucursales, tipo de empresa,
                CIF/NIF, etc. */}
            <section className="rounded-xl border bg-slate-50/40 p-4">
              <header className="flex items-center gap-2 mb-2">
                <Info className="h-4 w-4 text-slate-500" />
                <h3 className="text-sm font-semibold text-slate-900">Información general</h3>
              </header>
              <textarea
                value={form.infoGeneral ?? ""}
                onChange={(e) => update("infoGeneral", e.target.value)}
                rows={4}
                placeholder={
                  "Datos adicionales del cliente: dirección, CIF, horarios, sucursales, persona responsable de facturación, particularidades…"
                }
                className="w-full px-3 py-2 rounded-lg border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            </section>

            {/* Accesos — credenciales y URLs del cliente. Texto libre por
                ahora. Aviso de sensibilidad. */}
            <section className="rounded-xl border bg-amber-50/30 border-amber-200 p-4">
              <header className="flex items-center gap-2 mb-2">
                <KeyRound className="h-4 w-4 text-amber-700" />
                <h3 className="text-sm font-semibold text-amber-900">Accesos</h3>
                <span className="ml-auto text-[10px] text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded">
                  Sensible
                </span>
              </header>
              <textarea
                value={form.accesos ?? ""}
                onChange={(e) => update("accesos", e.target.value)}
                rows={5}
                placeholder={
                  "Una entrada por línea, ej:\nWordPress · cliente.com/wp-admin · admin@cliente.com · contraseña-123\ncPanel · cpanel.cliente.com · user · pass\nGMB · cliente@gmail.com · 2FA en móvil de Pedro\nMetricool · admin@cliente.com · ..."
                }
                className="w-full px-3 py-2 rounded-lg border border-amber-200 bg-white text-sm font-mono focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
              <p className="mt-1 text-[11px] text-amber-700">
                Acceso restringido al workspace. Texto plano por ahora — para compartir con terceros usa la sección Magic Links del admin.
              </p>
            </section>

            {/* Servicios contratados — multi-select con chips. */}
            <section className="rounded-xl border bg-violet-50/30 border-violet-200 p-4">
              <header className="flex items-center gap-2 mb-2">
                <ListChecks className="h-4 w-4 text-violet-700" />
                <h3 className="text-sm font-semibold text-violet-900">Servicios contratados</h3>
              </header>
              <div className="flex flex-wrap gap-1.5 mb-3">
                {SERVICIOS.map((s) => {
                  const sel = (form.servicios ?? []).includes(s.key);
                  return (
                    <button
                      key={s.key}
                      type="button"
                      onClick={() => toggleServicio(s.key)}
                      className={
                        "px-2.5 py-1 rounded-md text-xs transition border " +
                        (sel
                          ? "bg-violet-100 border-violet-400 text-violet-800 font-medium"
                          : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50")
                      }
                    >
                      {sel ? "✓ " : ""}{s.label}
                    </button>
                  );
                })}
              </div>
              <div className="flex items-center gap-3">
                <label className="text-xs font-medium text-slate-700">KIT DIGITAL:</label>
                <select
                  value={form.kitDigital ? "yes" : "no"}
                  onChange={(e) => update("kitDigital", e.target.value === "yes")}
                  className="px-3 py-1.5 rounded-lg border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
                >
                  <option value="no">No</option>
                  <option value="yes">Sí</option>
                </select>
              </div>
            </section>
          </>
        )}

        {error && <p className="text-xs text-rose-600">{error}</p>}
      </form>
    </Modal>
  );
}
