"use client";

import { Fragment, useEffect, useState } from "react";
import PageHeader from "@/components/PageHeader";
import Modal from "@/components/ui/Modal";
import { Plus, Loader2, Trash2, Edit2, Shield, ShieldCheck, ChevronDown, ChevronRight, Check, X as XIcon } from "lucide-react";
import ImageUpload from "@/components/ui/ImageUpload";
import { FEATURES, FEATURE_LABEL, FEATURE_DESCRIPTION, defaultFeaturesForRole, type Feature } from "@/lib/features";
import {
  ADMIN_SECTIONS,
  grantableCardsBySection,
  sectionIsGrantable,
  normalizeAdminGrants
} from "@/lib/admin-catalog";

type Member = {
  id: string;
  name: string | null;
  email: string;
  image: string | null;
  role: "ADMIN" | "MEMBER" | "GUEST";
  features?: string[] | null;
  adminGrants?: { sections?: string[]; cards?: string[] } | null;
  joinedAt: string;
};

const roleLabel: Record<Member["role"], string> = {
  ADMIN: "Administrador",
  MEMBER: "Miembro",
  GUEST: "Invitado"
};

const roleStyle: Record<Member["role"], string> = {
  ADMIN: "bg-violet-50 text-violet-700 border-violet-200",
  MEMBER: "bg-sky-50 text-sky-700 border-sky-200",
  GUEST: "bg-slate-50 text-slate-600 border-slate-200"
};

// Matriz de capacidades por rol — refleja el gating actual del sistema.
const PERMISSIONS: { group: string; items: { label: string; allow: Record<Member["role"], boolean> }[] }[] = [
  {
    group: "Datos financieros",
    items: [
      { label: "Ver MRR de cada cliente y MRR total", allow: { ADMIN: true, MEMBER: false, GUEST: false } },
      { label: "Editar MRR desde la ficha de cliente", allow: { ADMIN: true, MEMBER: false, GUEST: false } }
    ]
  },
  {
    group: "Workspace y equipo",
    items: [
      { label: "Crear, editar y eliminar usuarios", allow: { ADMIN: true, MEMBER: false, GUEST: false } },
      { label: "Configurar API keys, IA y integraciones (Asana, Drive, Metricool…)", allow: { ADMIN: true, MEMBER: false, GUEST: false } },
      { label: "Ver auditoría y backups", allow: { ADMIN: true, MEMBER: false, GUEST: false } }
    ]
  },
  {
    group: "Clientes",
    items: [
      { label: "Ver listado y fichas de clientes", allow: { ADMIN: true, MEMBER: true, GUEST: true } },
      { label: "Crear y editar clientes (datos, contacto, servicios)", allow: { ADMIN: true, MEMBER: true, GUEST: false } },
      { label: "Acceder a credenciales/accesos del cliente", allow: { ADMIN: true, MEMBER: true, GUEST: false } },
      { label: "Eliminar clientes", allow: { ADMIN: true, MEMBER: true, GUEST: false } }
    ]
  },
  {
    group: "Tareas y proyectos",
    items: [
      { label: "Ver tableros, lista y calendario", allow: { ADMIN: true, MEMBER: true, GUEST: true } },
      { label: "Crear y editar tareas, proyectos y eventos", allow: { ADMIN: true, MEMBER: true, GUEST: false } }
    ]
  },
  {
    group: "Calendario editorial",
    items: [
      { label: "Ver publicaciones planificadas", allow: { ADMIN: true, MEMBER: true, GUEST: true } },
      { label: "Crear/editar publicaciones y aprobar mes", allow: { ADMIN: true, MEMBER: true, GUEST: false } },
      { label: "Generar copy/imagen con IA y exportar a Metricool", allow: { ADMIN: true, MEMBER: true, GUEST: false } }
    ]
  },
  {
    group: "Asistente IA (Hub)",
    items: [
      { label: "Chatear con el asistente y usar tools del workspace", allow: { ADMIN: true, MEMBER: true, GUEST: false } },
      { label: "Configurar el modelo y la API key de IA", allow: { ADMIN: true, MEMBER: false, GUEST: false } }
    ]
  }
];

export default function UsuariosClient() {
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<Member | null>(null);

  // Selección múltiple para bulk delete.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);

  // Panel "Permisos por rol" colapsado por defecto (no satura).
  const [permsOpen, setPermsOpen] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const r = await fetch("/api/v1/users");
      if (r.ok) {
        const d = await r.json();
        setMembers(d.items ?? []);
        // Limpia selección de IDs que ya no existen.
        setSelected((s) => {
          const next = new Set<string>();
          const ids = new Set((d.items ?? []).map((m: Member) => m.id));
          for (const id of s) if (ids.has(id)) next.add(id);
          return next;
        });
      } else {
        setError(`Error ${r.status}`);
      }
    } catch (e: any) {
      setError(e.message);
    }
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function handleDelete(m: Member) {
    if (!confirm(`¿Eliminar a ${m.name || m.email} del workspace?`)) return;
    const r = await fetch(`/api/v1/users/${m.id}`, { method: "DELETE" });
    if (r.ok) {
      load();
      return;
    }
    const d = await r.json().catch(() => ({}));
    const msg = d?.error?.message ?? `Error ${r.status}`;
    if (d?.error?.code === "has_content") {
      if (
        confirm(
          `${msg}\n\n¿Quieres ELIMINARLO COMPLETAMENTE de todas formas? Sus tareas/comentarios quedarán sin asignar pero NO se borrarán.`
        )
      ) {
        await hardDelete(m);
      }
      return;
    }
    alert(`No se pudo eliminar: ${msg}`);
  }

  // Borrado completo explícito (botón dedicado para admins). Elimina la
  // cuenta global del usuario, no solo su pertenencia al workspace.
  async function hardDelete(m: Member) {
    if (
      !confirm(
        `⚠️ ELIMINAR COMPLETAMENTE a ${m.name || m.email}.\n\n` +
          `Esto borra su cuenta global (no solo de este workspace). Su contenido (tareas, comentarios) queda sin asignar pero NO se borra. Acción irreversible.\n\n¿Continuar?`
      )
    )
      return;
    const r = await fetch(`/api/v1/users/${m.id}?hard=true`, { method: "DELETE" });
    if (r.ok) {
      load();
      return;
    }
    const d = await r.json().catch(() => ({}));
    alert(`No se pudo eliminar: ${d?.error?.message ?? `Error ${r.status}`}`);
  }

  function toggleSelect(id: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleSelectAll() {
    setSelected((s) => (s.size === members.length ? new Set() : new Set(members.map((m) => m.id))));
  }

  async function handleBulkDelete() {
    if (selected.size === 0) return;
    const names = members.filter((m) => selected.has(m.id)).map((m) => m.name || m.email);
    const preview = names.slice(0, 5).join(", ") + (names.length > 5 ? `, y ${names.length - 5} más` : "");
    if (!confirm(`Vas a eliminar ${selected.size} usuario(s) del workspace:\n\n${preview}\n\n¿Continuar?`)) return;
    setBulkDeleting(true);
    const results = await Promise.allSettled(
      Array.from(selected).map((id) => fetch(`/api/v1/users/${id}`, { method: "DELETE" }))
    );
    setBulkDeleting(false);
    const failed = results.filter((r) => r.status === "rejected" || (r.status === "fulfilled" && !r.value.ok)).length;
    if (failed > 0) alert(`${failed} usuario(s) no se pudieron eliminar.`);
    setSelected(new Set());
    load();
  }

  const allSelected = members.length > 0 && selected.size === members.length;
  const someSelected = selected.size > 0 && !allSelected;

  return (
    <div className="max-w-5xl mx-auto">
      <PageHeader
        title="Usuarios y permisos"
        description="Gestiona el equipo del workspace y sus roles."
        actions={
          <button
            onClick={() => setCreateOpen(true)}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium"
          >
            <Plus className="h-4 w-4" />
            Nuevo usuario
          </button>
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
        <StatCard label="Total" value={members.length} />
        <StatCard label="Admins" value={members.filter((m) => m.role === "ADMIN").length} icon={<ShieldCheck className="h-4 w-4 text-violet-500" />} />
        <StatCard label="Miembros" value={members.filter((m) => m.role === "MEMBER").length} icon={<Shield className="h-4 w-4 text-sky-500" />} />
      </div>

      {/* Permisos por rol — sección colapsable */}
      <div className="bg-white rounded-xl border mb-6 overflow-hidden">
        <button
          type="button"
          onClick={() => setPermsOpen((o) => !o)}
          className="w-full flex items-center justify-between px-5 py-3 hover:bg-slate-50"
        >
          <div className="text-left">
            <div className="text-sm font-semibold">Qué puede hacer cada rol</div>
            <div className="text-xs text-slate-500 mt-0.5">
              Resumen de los permisos de Administrador, Miembro e Invitado en toda la plataforma.
            </div>
          </div>
          {permsOpen ? <ChevronDown className="h-4 w-4 text-slate-400" /> : <ChevronRight className="h-4 w-4 text-slate-400" />}
        </button>
        {permsOpen && (
          <div className="border-t">
            {/* Mini-resúmenes por rol */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 p-5 border-b bg-slate-50/50">
              <RoleSummary
                role="ADMIN"
                title="Administrador"
                tagline="Acceso total al workspace."
                bullets={[
                  "Ve datos financieros (MRR)",
                  "Gestiona usuarios, API keys e integraciones",
                  "Configura IA y backups"
                ]}
              />
              <RoleSummary
                role="MEMBER"
                title="Miembro"
                tagline="Uso diario operativo."
                bullets={[
                  "Crea y edita clientes, tareas y publicaciones",
                  "Usa el asistente IA y el calendario editorial",
                  "No ve MRR ni gestiona equipo/integraciones"
                ]}
              />
              <RoleSummary
                role="GUEST"
                title="Invitado"
                tagline="Solo lectura."
                bullets={[
                  "Ve listados de clientes, tareas y calendario",
                  "No puede crear ni editar nada",
                  "Sin acceso al asistente IA"
                ]}
              />
            </div>
            {/* Tabla detallada de capacidades */}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="text-left px-5 py-2 font-medium">Capacidad</th>
                    <th className="text-center px-3 py-2 font-medium w-24">Admin</th>
                    <th className="text-center px-3 py-2 font-medium w-24">Miembro</th>
                    <th className="text-center px-3 py-2 font-medium w-24">Invitado</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {PERMISSIONS.map((g) => (
                    <Fragment key={g.group}>
                      <tr className="bg-slate-50/40">
                        <td colSpan={4} className="px-5 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                          {g.group}
                        </td>
                      </tr>
                      {g.items.map((it, i) => (
                        <tr key={g.group + i} className="hover:bg-slate-50">
                          <td className="px-5 py-2 text-slate-700">{it.label}</td>
                          <td className="px-3 py-2 text-center"><Allow yes={it.allow.ADMIN} /></td>
                          <td className="px-3 py-2 text-center"><Allow yes={it.allow.MEMBER} /></td>
                          <td className="px-3 py-2 text-center"><Allow yes={it.allow.GUEST} /></td>
                        </tr>
                      ))}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="px-5 py-3 text-[11px] text-slate-500 border-t bg-slate-50/50">
              Permisos aplicados en la UI y en endpoints sensibles. El control granular por proyecto / cliente individual llegará más adelante.
            </p>
          </div>
        )}
      </div>

      {/* Barra de bulk-delete cuando hay selección */}
      {selected.size > 0 && (
        <div className="mb-3 flex items-center justify-between gap-3 px-4 py-2.5 rounded-lg bg-rose-50 border border-rose-200">
          <div className="text-sm text-rose-800">
            <strong>{selected.size}</strong> usuario(s) seleccionado(s)
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setSelected(new Set())}
              className="px-2.5 py-1 rounded text-xs text-slate-600 hover:bg-white"
            >
              Cancelar selección
            </button>
            <button
              onClick={handleBulkDelete}
              disabled={bulkDeleting}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-medium disabled:opacity-50"
            >
              {bulkDeleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
              Eliminar seleccionados
            </button>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border overflow-x-auto">
        {loading ? (
          <div className="p-8 text-sm text-slate-500 flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Cargando…
          </div>
        ) : error ? (
          <div className="p-8 text-sm text-rose-600">{error}</div>
        ) : members.length === 0 ? (
          <div className="p-8 text-sm text-slate-500">
            Aún no hay miembros.{" "}
            <button onClick={() => setCreateOpen(true)} className="text-brand-600 underline">
              Añade el primero
            </button>
            .
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-3 w-10">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = someSelected;
                    }}
                    onChange={toggleSelectAll}
                    className="accent-rose-600 h-4 w-4"
                    aria-label="Seleccionar todos"
                  />
                </th>
                <th className="text-left px-3 py-3">Usuario</th>
                <th className="text-left px-3 py-3">Email</th>
                <th className="text-left px-3 py-3">Rol</th>
                <th className="text-left px-3 py-3">Desde</th>
                <th className="text-right px-5 py-3">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {members.map((m) => {
                const isSel = selected.has(m.id);
                return (
                  <tr key={m.id} className={"hover:bg-slate-50 " + (isSel ? "bg-rose-50/30" : "")}>
                    <td className="px-3 py-3">
                      <input
                        type="checkbox"
                        checked={isSel}
                        onChange={() => toggleSelect(m.id)}
                        className="accent-rose-600 h-4 w-4"
                        aria-label={`Seleccionar ${m.name || m.email}`}
                      />
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-3">
                        <div className="h-8 w-8 rounded-full bg-brand-500 text-white grid place-items-center text-xs font-semibold">
                          {(m.name || m.email).slice(0, 2).toUpperCase()}
                        </div>
                        <span className="font-medium">{m.name || "—"}</span>
                      </div>
                    </td>
                    <td className="px-3 py-3 text-slate-600">{m.email}</td>
                    <td className="px-3 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-md border ${roleStyle[m.role]}`}>
                        {roleLabel[m.role]}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-xs text-slate-500">
                      {new Date(m.joinedAt).toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" })}
                    </td>
                    <td className="px-5 py-3 text-right">
                      <button
                        onClick={() => setEditing(m)}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs text-slate-600 hover:bg-slate-100"
                      >
                        <Edit2 className="h-3.5 w-3.5" />
                        Editar
                      </button>
                      <button
                        onClick={() => handleDelete(m)}
                        className="ml-1 inline-flex items-center gap-1 px-2 py-1 rounded text-xs text-rose-600 hover:bg-rose-50"
                        title="Quitar del workspace (conserva la cuenta global)"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Quitar
                      </button>
                      <button
                        onClick={() => hardDelete(m)}
                        className="ml-1 inline-flex items-center gap-1 px-2 py-1 rounded text-xs text-white bg-rose-600 hover:bg-rose-700"
                        title="Eliminar la cuenta global por completo"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Eliminar
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <p className="mt-4 text-xs text-slate-500">
        Para limitar a qué proyectos accede cada miembro o invitado, edita el usuario y desmarca los proyectos en la sección "Acceso a proyectos".
      </p>

      <UserFormModal
        open={createOpen}
        workspaceMembers={members}
        onClose={() => setCreateOpen(false)}
        onSaved={() => {
          setCreateOpen(false);
          load();
        }}
      />
      <UserFormModal
        open={!!editing}
        workspaceMembers={members}
        onClose={() => setEditing(null)}
        member={editing ?? undefined}
        onSaved={() => {
          setEditing(null);
          load();
        }}
      />
    </div>
  );
}

function Allow({ yes }: { yes: boolean }) {
  return yes ? (
    <span className="inline-flex items-center justify-center h-5 w-5 rounded-full bg-emerald-50 text-emerald-600">
      <Check className="h-3 w-3" />
    </span>
  ) : (
    <span className="inline-flex items-center justify-center h-5 w-5 rounded-full bg-slate-100 text-slate-400">
      <XIcon className="h-3 w-3" />
    </span>
  );
}

function RoleSummary({
  role,
  title,
  tagline,
  bullets
}: {
  role: Member["role"];
  title: string;
  tagline: string;
  bullets: string[];
}) {
  const Icon = role === "ADMIN" ? ShieldCheck : Shield;
  return (
    <div className="bg-white rounded-lg border p-4">
      <div className="flex items-center gap-2 mb-1">
        <span className={`inline-flex items-center justify-center h-7 w-7 rounded-md border ${roleStyle[role]}`}>
          <Icon className="h-3.5 w-3.5" />
        </span>
        <div className="font-semibold text-sm">{title}</div>
      </div>
      <p className="text-xs text-slate-500 mb-2">{tagline}</p>
      <ul className="space-y-1">
        {bullets.map((b) => (
          <li key={b} className="text-xs text-slate-700 flex items-start gap-1.5">
            <span className="text-brand-500 leading-none mt-0.5">•</span>
            <span>{b}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function StatCard({ label, value, icon }: { label: string; value: number; icon?: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border p-5 flex items-center justify-between">
      <div>
        <div className="text-xs text-slate-500 flex items-center gap-1.5">{icon}{label}</div>
        <div className="text-2xl font-semibold mt-1">{value}</div>
      </div>
    </div>
  );
}

function UserFormModal({
  open,
  onClose,
  member,
  workspaceMembers,
  onSaved
}: {
  open: boolean;
  onClose: () => void;
  member?: Member;
  workspaceMembers: Member[];
  onSaved: () => void;
}) {
  const isEdit = !!member;
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [image, setImage] = useState("");
  const [role, setRole] = useState<Member["role"]>("MEMBER");
  // featuresMode: "default" = aplicar defaults del rol (Membership.features = null).
  // "custom" = lista explícita marcada por el admin.
  const [featuresMode, setFeaturesMode] = useState<"default" | "custom">("default");
  const [customFeatures, setCustomFeatures] = useState<Feature[]>([]);
  // Acceso al panel de administración (solo edición + no-admin). Conjunto de
  // ids de sección concedidas + hrefs de tarjeta sueltas concedidas.
  const [grantSections, setGrantSections] = useState<Set<string>>(new Set());
  const [grantCards, setGrantCards] = useState<Set<string>>(new Set());
  const [expandedSection, setExpandedSection] = useState<string | null>(null);
  // Acceso por proyecto (solo edición + no-admin). Lo cargamos asíncronamente
  // al abrir el modal con el user existente. allowedProjectIds = los que el
  // admin tiene marcados ahora mismo en la UI; al guardar, mandamos esa lista
  // a PUT /users/:id/project-access que reconcilia ProjectMember.
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [projects, setProjects] = useState<
    { id: string; name: string; clientName: string | null; hasMember: boolean; isOpenProject: boolean }[]
  >([]);
  const [allowedProjectIds, setAllowedProjectIds] = useState<Set<string>>(new Set());
  const [projectFilter, setProjectFilter] = useState("");
  const [platformsLoading, setPlatformsLoading] = useState(false);
  const [platformCatalog, setPlatformCatalog] = useState<
    { key: string; label: string; description: string; available: boolean; defaultEnabled?: boolean }[]
  >([]);
  const [platformConfig, setPlatformConfig] = useState<Record<string, { enabled: boolean; memberIds: string[]; restricted?: boolean; customLabel?: string }>>({});
  const [allowedPlatformKeys, setAllowedPlatformKeys] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    if (member) {
      setName(member.name ?? "");
      setEmail(member.email);
      setRole(member.role);
      setPassword("");
      setPhone((member as any).phone ?? "");
      setImage((member as any).image ?? "");
      // features: null en BD → modo default. Array → modo custom.
      if (Array.isArray(member.features)) {
        setFeaturesMode("custom");
        setCustomFeatures(member.features.filter((f): f is Feature => (FEATURES as readonly string[]).includes(f)));
      } else {
        setFeaturesMode("default");
        setCustomFeatures(defaultFeaturesForRole(member.role));
      }
      const g = normalizeAdminGrants(member.adminGrants);
      setGrantSections(new Set(g.sections));
      setGrantCards(new Set(g.cards));
    } else {
      setName("");
      setEmail("");
      setPassword("");
      setPhone("");
      setImage("");
      setRole("MEMBER");
      setFeaturesMode("default");
      setCustomFeatures(defaultFeaturesForRole("MEMBER"));
      setGrantSections(new Set());
      setGrantCards(new Set());
    }
    setExpandedSection(null);
    // Reset proyectos al cambiar de modal
    setProjects([]);
    setAllowedProjectIds(new Set());
    setProjectFilter("");
    setPlatformCatalog([]);
    setPlatformConfig({});
    setAllowedPlatformKeys(new Set());
    // Cargar acceso a proyectos solo en edición (en creación, el user
    // aún no existe en BD).
    if (member && open) {
      setPlatformsLoading(true);
      fetch("/api/v1/admin/platforms", { cache: "no-store" })
        .then(async (r) => {
          if (!r.ok) throw new Error(`Error ${r.status}`);
          return r.json();
        })
        .then((data) => {
          const catalog = data.catalog ?? [];
          const config = data.config ?? {};
          setPlatformCatalog(catalog);
          setPlatformConfig(config);
          const initial = new Set<string>();
          for (const platform of catalog) {
            const cfg = config[platform.key];
            const enabled = cfg ? !!cfg.enabled : !!platform.defaultEnabled;
            if (!enabled || !platform.available) continue;
            const isPublic = !cfg?.restricted && (!cfg?.memberIds || cfg.memberIds.length === 0);
            if (isPublic || cfg?.memberIds?.includes(member.id)) initial.add(platform.key);
          }
          setAllowedPlatformKeys(initial);
        })
        .catch((e) => console.warn("platform-access load failed", e))
        .finally(() => setPlatformsLoading(false));

      setProjectsLoading(true);
      fetch(`/api/v1/users/${member.id}/project-access`, { cache: "no-store" })
        .then(async (r) => {
          if (!r.ok) throw new Error(`Error ${r.status}`);
          return r.json();
        })
        .then((data) => {
          const items = (data.items ?? []) as typeof projects;
          setProjects(items);
          // Si el proyecto está "abierto" (sin members) Y el user no tiene
          // member row, lo consideramos "tiene acceso" en la UI inicial —
          // así no le quitamos accesos por accidente al primer guardado.
          // Si el admin marca/desmarca explícitamente, eso es lo que se
          // persiste.
          const initial = new Set<string>();
          for (const p of items) {
            if (p.hasMember || p.isOpenProject) initial.add(p.id);
          }
          setAllowedProjectIds(initial);
        })
        .catch((e) => {
          // No bloqueamos la edición principal por esto — el error se
          // pinta en la sección de proyectos.
          console.warn("project-access load failed", e);
        })
        .finally(() => setProjectsLoading(false));
    }
  }, [open, member]);

  // Cuando cambia el rol y aún no se ha pasado a "custom", reseteamos
  // los checks al default del nuevo rol para que se vea coherente.
  useEffect(() => {
    if (featuresMode === "default") setCustomFeatures(defaultFeaturesForRole(role));
  }, [role, featuresMode]);

  function toggleFeature(f: Feature) {
    setCustomFeatures((arr) => (arr.includes(f) ? arr.filter((x) => x !== f) : [...arr, f]));
  }

  function toggleGrantSection(sectionId: string) {
    setGrantSections((s) => {
      const next = new Set(s);
      if (next.has(sectionId)) next.delete(sectionId);
      else {
        next.add(sectionId);
        // Al conceder la sección entera, limpiamos las tarjetas sueltas de esa
        // sección (quedan cubiertas) para no guardar redundancias.
        setGrantCards((cards) => {
          const nc = new Set(cards);
          for (const c of grantableCardsBySection(sectionId)) nc.delete(c.href);
          return nc;
        });
      }
      return next;
    });
  }

  function toggleGrantCard(href: string) {
    setGrantCards((s) => {
      const next = new Set(s);
      if (next.has(href)) next.delete(href);
      else next.add(href);
      return next;
    });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!isEdit && (!name || !email || password.length < 8)) {
      return setError("Nombre, email y contraseña (mínimo 8) son obligatorios");
    }
    setSaving(true);
    const url = isEdit ? `/api/v1/users/${member!.id}` : "/api/v1/users";
    const method = isEdit ? "PATCH" : "POST";
    const payload: any = { name, email, role, phone: phone || null, image: image || null };
    if (password) payload.password = password;
    // features: solo se envía al editar (PATCH). En el endpoint POST aún
    // no se acepta; tras crear el usuario, edítalo para afinar. Para
    // ADMIN siempre forzamos null (la lista no aplica a admins).
    if (isEdit) {
      if (role === "ADMIN") payload.features = null;
      else if (featuresMode === "default") payload.features = null;
      else payload.features = customFeatures;
      // Acceso al panel admin: ADMIN ve todo (null). Para el resto, mandamos
      // las secciones/tarjetas concedidas (null si no hay ninguna).
      if (role === "ADMIN") payload.adminGrants = null;
      else {
        const sections = [...grantSections];
        const cards = [...grantCards];
        payload.adminGrants = sections.length || cards.length ? { sections, cards } : null;
      }
    }

    const r = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!r.ok) {
      setSaving(false);
      const j = await r.json().catch(() => ({}));
      return setError(j.message || `Error ${r.status}`);
    }
    // Persistimos también el acceso a proyectos si estamos editando un
    // no-admin. Para crear, el endpoint POST aún no acepta projects —
    // tras crearlo se edita.
    if (isEdit && member && role !== "ADMIN") {
      try {
        const pr = await fetch(`/api/v1/users/${member.id}/project-access`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectIds: [...allowedProjectIds] })
        });
        if (!pr.ok) {
          setSaving(false);
          const j = await pr.json().catch(() => ({}));
          return setError(j.message || `Error guardando acceso a proyectos (${pr.status})`);
        }
      } catch (e: any) {
        setSaving(false);
        return setError(e?.message ?? "Error guardando acceso a proyectos");
      }
    }
    if (isEdit && member && role !== "ADMIN") {
      try {
        for (const platform of platformCatalog) {
          const cfg = platformConfig[platform.key];
          const enabled = cfg ? !!cfg.enabled : !!platform.defaultEnabled;
          if (!enabled || !platform.available) continue;
          const memberIds = new Set<string>(cfg?.memberIds ?? []);
          const isPublic = !cfg?.restricted && memberIds.size === 0;
          const shouldHaveAccess = allowedPlatformKeys.has(platform.key);
          if (isPublic && shouldHaveAccess) continue;
          if (isPublic) {
            for (const other of workspaceMembers) {
              if (other.id !== member.id && other.role !== "ADMIN") memberIds.add(other.id);
            }
          } else if (shouldHaveAccess) memberIds.add(member.id);
          else memberIds.delete(member.id);
          const pr = await fetch("/api/v1/admin/platforms", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ key: platform.key, memberIds: [...memberIds], restricted: true })
          });
          if (!pr.ok) throw new Error(`Error guardando plataforma ${platform.label} (${pr.status})`);
        }
      } catch (e: any) {
        setSaving(false);
        return setError(e?.message ?? "Error guardando acceso a plataformas");
      }
    }
    setSaving(false);
    onSaved();
  }

  function toggleProject(id: string) {
    setAllowedProjectIds((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }
  function selectAllProjects(value: boolean) {
    if (value) setAllowedProjectIds(new Set(projects.map((p) => p.id)));
    else setAllowedProjectIds(new Set());
  }

  function togglePlatform(key: string) {
    setAllowedPlatformKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? "Editar usuario" : "Nuevo usuario"}
      size="md"
      footer={
        <>
          <button type="button" onClick={onClose} className="px-3 py-2 rounded-lg text-sm border bg-white hover:bg-slate-50">
            Cancelar
          </button>
          <button
            type="submit"
            form="user-form"
            disabled={saving}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium disabled:opacity-50"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {isEdit ? "Guardar cambios" : "Crear usuario"}
          </button>
        </>
      }
    >
      <form id="user-form" onSubmit={submit} className="space-y-4">
        {isEdit && member && (
          <ImageUpload
            value={image}
            onChange={setImage}
            targetType="USER"
            targetId={member.id}
            shape="circle"
            label="Foto de perfil"
            size={64}
          />
        )}
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">Nombre</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            className="w-full px-3 py-2 rounded-lg border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">
            Teléfono <span className="text-slate-400 font-normal">(para futuras notificaciones por SMS/WhatsApp)</span>
          </label>
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+34 6XX XXX XXX"
            className="w-full px-3 py-2 rounded-lg border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">
            Contraseña {isEdit && <span className="text-slate-400 font-normal">(dejar vacía para no cambiarla)</span>}
          </label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={isEdit ? "Mínimo 8 caracteres si la cambias" : "Mínimo 8 caracteres"}
            className="w-full px-3 py-2 rounded-lg border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">Rol</label>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as Member["role"])}
            className="w-full px-3 py-2 rounded-lg border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          >
            <option value="ADMIN">Administrador — acceso total</option>
            <option value="MEMBER">Miembro — uso diario</option>
            <option value="GUEST">Invitado — solo lectura</option>
          </select>
        </div>

        {/* Acceso a herramientas: solo aplicable a no-admins. Para crear
            un usuario nuevo el panel queda informativo (la lista se
            guarda al editarlo después del POST). */}
        {role !== "ADMIN" && (
          <div className="border rounded-lg p-3 bg-slate-50/50">
            <div className="flex items-start justify-between gap-3 mb-2">
              <div>
                <div className="text-xs font-semibold text-slate-700">Acceso a herramientas</div>
                <div className="text-[11px] text-slate-500">
                  {role === "MEMBER"
                    ? "Por defecto un Miembro accede a todas. Restringe si este usuario sólo debe ver 1-2 secciones."
                    : "Por defecto un Invitado accede a vistas de lectura. Puedes recortar más si quieres."}
                </div>
              </div>
              <div className="inline-flex rounded-md border bg-white text-[11px] shrink-0">
                <button
                  type="button"
                  onClick={() => setFeaturesMode("default")}
                  className={
                    "px-2 py-1 rounded-l-md " +
                    (featuresMode === "default" ? "bg-brand-50 text-brand-700 font-medium" : "text-slate-500 hover:bg-slate-50")
                  }
                >
                  Por defecto del rol
                </button>
                <button
                  type="button"
                  onClick={() => setFeaturesMode("custom")}
                  className={
                    "px-2 py-1 rounded-r-md border-l " +
                    (featuresMode === "custom" ? "bg-brand-50 text-brand-700 font-medium" : "text-slate-500 hover:bg-slate-50")
                  }
                >
                  Personalizado
                </button>
              </div>
            </div>

            {!isEdit && featuresMode === "custom" && (
              <p className="mb-2 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
                Las restricciones personalizadas se aplican al editar al usuario después de crearlo.
              </p>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              {FEATURES.map((f) => {
                const checked = customFeatures.includes(f);
                const disabled = featuresMode === "default";
                return (
                  <label
                    key={f}
                    className={
                      "flex items-start gap-2 px-2 py-1.5 rounded border bg-white text-xs cursor-pointer " +
                      (disabled ? "opacity-60 cursor-not-allowed " : "hover:border-brand-300 ") +
                      (checked ? "border-brand-300" : "border-slate-200")
                    }
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={disabled}
                      onChange={() => toggleFeature(f)}
                      className="accent-brand-600 mt-0.5"
                    />
                    <span className="flex-1 min-w-0">
                      <span className="block font-medium text-slate-800">{FEATURE_LABEL[f]}</span>
                      <span className="block text-[10px] text-slate-500 leading-tight">{FEATURE_DESCRIPTION[f]}</span>
                    </span>
                  </label>
                );
              })}
            </div>

            {featuresMode === "custom" && customFeatures.length === 0 && (
              <p className="mt-2 text-[11px] text-rose-600">
                Sin acceso a ninguna herramienta — el usuario sólo verá su perfil.
              </p>
            )}
          </div>
        )}

        {role === "ADMIN" && (
          <p className="text-[11px] text-slate-500 italic">
            Los administradores siempre tienen acceso a todas las herramientas y a las opciones de gestión del workspace.
          </p>
        )}

        {/* Acceso al panel de ADMINISTRACIÓN: solo edición + no-admin. Concede
            secciones enteras o tarjetas sueltas del panel /admin. Las tarjetas
            sensibles (usuarios, bóveda, API keys, auditoría…) nunca se ofrecen. */}
        {isEdit && role !== "ADMIN" && (
          <div className="border rounded-lg p-3 bg-violet-50/40 border-violet-200">
            <div className="mb-2">
              <div className="text-xs font-semibold text-slate-700">Acceso al panel de administración</div>
              <div className="text-[11px] text-slate-500">
                Da acceso a secciones o tarjetas concretas del panel <span className="font-mono">/admin</span>. Marca
                una sección entera, o despliégala para elegir tarjetas sueltas. Por defecto, sin acceso.
              </div>
            </div>

            <div className="space-y-1">
              {ADMIN_SECTIONS.filter((s) => sectionIsGrantable(s.id)).map((s) => {
                const cards = grantableCardsBySection(s.id);
                const sectionOn = grantSections.has(s.id);
                const expanded = expandedSection === s.id;
                const cardOnCount = sectionOn
                  ? cards.length
                  : cards.filter((c) => grantCards.has(c.href)).length;
                return (
                  <div key={s.id} className="rounded border bg-white">
                    <div className="flex items-center gap-2 px-2 py-1.5">
                      <input
                        type="checkbox"
                        checked={sectionOn}
                        onChange={() => toggleGrantSection(s.id)}
                        className="accent-violet-600"
                      />
                      <button
                        type="button"
                        onClick={() => setExpandedSection(expanded ? null : s.id)}
                        className="flex-1 flex items-center justify-between gap-2 text-left min-w-0"
                      >
                        <span className="text-xs font-medium text-slate-800 truncate">{s.title}</span>
                        <span className="flex items-center gap-1.5 shrink-0">
                          {cardOnCount > 0 && (
                            <span className="text-[10px] text-violet-700 bg-violet-100 rounded px-1.5 py-0.5">
                              {sectionOn ? "Sección" : `${cardOnCount}/${cards.length}`}
                            </span>
                          )}
                          {expanded ? (
                            <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
                          ) : (
                            <ChevronRight className="h-3.5 w-3.5 text-slate-400" />
                          )}
                        </span>
                      </button>
                    </div>
                    {expanded && (
                      <div className="border-t px-2 py-1.5 grid grid-cols-1 sm:grid-cols-2 gap-1">
                        {cards.map((c) => {
                          const covered = sectionOn;
                          const checked = covered || grantCards.has(c.href);
                          return (
                            <label
                              key={c.href}
                              className={
                                "flex items-center gap-2 px-1.5 py-1 rounded text-[11px] " +
                                (covered ? "opacity-60 cursor-not-allowed" : "cursor-pointer hover:bg-slate-50")
                              }
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                disabled={covered}
                                onChange={() => toggleGrantCard(c.href)}
                                className="accent-violet-600"
                              />
                              <span className="truncate text-slate-700">{c.title}</span>
                            </label>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            {grantSections.size === 0 && grantCards.size === 0 && (
              <p className="mt-2 text-[11px] text-slate-500">
                Sin acceso al panel de administración (no verá <span className="font-mono">/admin</span>).
              </p>
            )}
          </div>
        )}

        {isEdit && role !== "ADMIN" && (
          <div className="border rounded-lg p-3 bg-sky-50/40 border-sky-200">
            <div className="flex items-start justify-between gap-3 mb-2">
              <div>
                <div className="text-xs font-semibold text-slate-700">Acceso a plataformas</div>
                <div className="text-[11px] text-slate-500">
                  Elige las plataformas que aparecerán en el menú de este trabajador. Los administradores siempre tienen acceso a todas.
                </div>
              </div>
              <div className="inline-flex rounded-md border bg-white text-[11px] shrink-0">
                <button
                  type="button"
                  onClick={() => setAllowedPlatformKeys(new Set(platformCatalog.filter((p) => {
                    const cfg = platformConfig[p.key];
                    return p.available && (cfg ? !!cfg.enabled : !!p.defaultEnabled);
                  }).map((p) => p.key)))}
                  className="px-2 py-1 rounded-l-md text-slate-600 hover:bg-slate-50"
                >
                  Todas
                </button>
                <button
                  type="button"
                  onClick={() => setAllowedPlatformKeys(new Set())}
                  className="px-2 py-1 rounded-r-md border-l text-slate-600 hover:bg-slate-50"
                >
                  Ninguna
                </button>
              </div>
            </div>
            {platformsLoading ? (
              <div className="flex items-center gap-2 text-xs text-slate-500 py-2">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Cargando plataformas…
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                {platformCatalog.filter((p) => {
                  const cfg = platformConfig[p.key];
                  return p.available && (cfg ? !!cfg.enabled : !!p.defaultEnabled);
                }).map((p) => {
                  const checked = allowedPlatformKeys.has(p.key);
                  const cfg = platformConfig[p.key];
                  return (
                    <label
                      key={p.key}
                      className={`flex items-start gap-2 px-2 py-1.5 rounded border bg-white text-xs cursor-pointer ${checked ? "border-sky-300" : "border-slate-200"}`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => togglePlatform(p.key)}
                        className="accent-sky-600 mt-0.5"
                      />
                      <span className="min-w-0">
                        <span className="block font-medium text-slate-800 truncate">{cfg?.customLabel?.trim() || p.label}</span>
                        <span className="block text-[10px] text-slate-500 leading-tight line-clamp-2">{p.description}</span>
                      </span>
                    </label>
                  );
                })}
                {platformCatalog.filter((p) => {
                  const cfg = platformConfig[p.key];
                  return p.available && (cfg ? !!cfg.enabled : !!p.defaultEnabled);
                }).length === 0 && (
                  <p className="text-[11px] text-slate-500 italic">No hay plataformas activadas en el workspace.</p>
                )}
              </div>
            )}
          </div>
        )}

        {role === "ADMIN" && isEdit && (
          <p className="text-[11px] text-sky-700 bg-sky-50 border border-sky-200 rounded-lg p-2">
            Plataformas: los administradores tienen acceso automático a todas las plataformas activas.
          </p>
        )}

        {/* Acceso por proyecto: solo en edición + no-admin. ADMIN ven todo
            siempre, no tiene sentido restringir. En creación, primero hay
            que crear el user (POST) y luego editarlo para asignar proyectos. */}
        {isEdit && role !== "ADMIN" && (
          <div className="border rounded-lg p-3 bg-slate-50/50">
            <div className="flex items-start justify-between gap-3 mb-2">
              <div>
                <div className="text-xs font-semibold text-slate-700">Acceso a proyectos</div>
                <div className="text-[11px] text-slate-500">
                  Marca los proyectos que este usuario puede ver y trabajar. Si lo desmarcas, no aparecerán en su Kanban/listado.
                </div>
              </div>
              <div className="inline-flex rounded-md border bg-white text-[11px] shrink-0">
                <button
                  type="button"
                  onClick={() => selectAllProjects(true)}
                  className="px-2 py-1 rounded-l-md text-slate-600 hover:bg-slate-50"
                >
                  Todos
                </button>
                <button
                  type="button"
                  onClick={() => selectAllProjects(false)}
                  className="px-2 py-1 rounded-r-md border-l text-slate-600 hover:bg-slate-50"
                >
                  Ninguno
                </button>
              </div>
            </div>

            {projectsLoading ? (
              <div className="flex items-center gap-2 text-xs text-slate-500 py-2">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Cargando proyectos…
              </div>
            ) : projects.length === 0 ? (
              <p className="text-[11px] text-slate-500 italic">No hay proyectos en el workspace.</p>
            ) : (
              <>
                <input
                  type="search"
                  value={projectFilter}
                  onChange={(e) => setProjectFilter(e.target.value)}
                  placeholder={`Filtrar (${projects.length} proyectos)…`}
                  className="w-full mb-2 px-2 py-1.5 rounded border bg-white text-xs focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
                <div className="max-h-56 overflow-y-auto border rounded bg-white">
                  {projects
                    .filter((p) => {
                      if (!projectFilter.trim()) return true;
                      const q = projectFilter.trim().toLowerCase();
                      return (
                        p.name.toLowerCase().includes(q) ||
                        (p.clientName ?? "").toLowerCase().includes(q)
                      );
                    })
                    .map((p) => {
                      const checked = allowedProjectIds.has(p.id);
                      return (
                        <label
                          key={p.id}
                          className={
                            "flex items-center gap-2 px-2 py-1.5 border-b last:border-b-0 text-xs cursor-pointer hover:bg-slate-50 " +
                            (checked ? "bg-brand-50/30" : "")
                          }
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleProject(p.id)}
                            className="accent-brand-600"
                          />
                          <span className="flex-1 min-w-0">
                            <span className="block font-medium text-slate-800 truncate">{p.name}</span>
                            {p.clientName && (
                              <span className="block text-[10px] text-slate-500 truncate">{p.clientName}</span>
                            )}
                          </span>
                          {p.isOpenProject && !p.hasMember && (
                            <span
                              title="Proyecto sin miembros asignados — visible para todo el workspace"
                              className="text-[10px] text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded"
                            >
                              abierto
                            </span>
                          )}
                        </label>
                      );
                    })}
                </div>
                <p className="mt-2 text-[10px] text-slate-500">
                  {allowedProjectIds.size} de {projects.length} marcados. Los proyectos "abiertos" lo son hasta que asignas a alguien — desde ese momento, solo los asignados los ven.
                </p>
              </>
            )}
          </div>
        )}

        {error && <p className="text-xs text-rose-600">{error}</p>}
      </form>
    </Modal>
  );
}
