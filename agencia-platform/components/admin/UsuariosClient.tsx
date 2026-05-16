"use client";

import { Fragment, useEffect, useState } from "react";
import PageHeader from "@/components/PageHeader";
import Modal from "@/components/ui/Modal";
import { Plus, Loader2, Trash2, Edit2, Shield, ShieldCheck, ChevronDown, ChevronRight, Check, X as XIcon } from "lucide-react";
import ImageUpload from "@/components/ui/ImageUpload";

type Member = {
  id: string;
  name: string | null;
  email: string;
  image: string | null;
  role: "ADMIN" | "MEMBER" | "GUEST";
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
    if (r.ok) load();
    else alert("No se pudo eliminar");
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
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Quitar
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
        El control granular de permisos por proyecto (qué trabajador entra a qué proyecto) llegará en el próximo PR.
      </p>

      <UserFormModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSaved={() => {
          setCreateOpen(false);
          load();
        }}
      />
      <UserFormModal
        open={!!editing}
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
  onSaved
}: {
  open: boolean;
  onClose: () => void;
  member?: Member;
  onSaved: () => void;
}) {
  const isEdit = !!member;
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [image, setImage] = useState("");
  const [role, setRole] = useState<Member["role"]>("MEMBER");
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
    } else {
      setName("");
      setEmail("");
      setPassword("");
      setPhone("");
      setImage("");
      setRole("MEMBER");
    }
  }, [open, member]);

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

    const r = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    setSaving(false);
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      return setError(j.message || `Error ${r.status}`);
    }
    onSaved();
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
        {error && <p className="text-xs text-rose-600">{error}</p>}
      </form>
    </Modal>
  );
}
