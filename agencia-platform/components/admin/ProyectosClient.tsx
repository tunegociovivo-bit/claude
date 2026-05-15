"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import Modal from "@/components/ui/Modal";
import ProjectFormModal from "@/components/forms/ProjectFormModal";
import type { UiClient } from "@/lib/db/queries";
import { Plus, Loader2, Users, UserPlus, X, ExternalLink, Globe2 } from "lucide-react";

type ProjectRow = {
  id: string;
  name: string;
  color: string;
  description: string | null;
  client?: { id: string; name: string } | null;
  _count: { tasks: number; members: number };
};

type Member = {
  id: string;
  name: string | null;
  email: string;
  role: "ADMIN" | "MEMBER" | "GUEST";
};

type WorkspaceUser = {
  id: string;
  name: string | null;
  email: string;
};

export default function ProyectosClient() {
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [clients, setClients] = useState<UiClient[]>([]);
  const [users, setUsers] = useState<WorkspaceUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [managingProject, setManagingProject] = useState<ProjectRow | null>(null);

  async function load() {
    setLoading(true);
    try {
      const [pr, cr, ur] = await Promise.all([
        fetch("/api/v1/projects"),
        fetch("/api/v1/clients"),
        fetch("/api/v1/users")
      ]);
      if (pr.ok) setProjects((await pr.json()).items ?? []);
      if (cr.ok) setClients((await cr.json()).items ?? []);
      if (ur.ok) setUsers(((await ur.json()).items ?? []).map((u: any) => ({ id: u.id, name: u.name, email: u.email })));
    } catch (e) {
      console.warn(e);
    }
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="max-w-5xl mx-auto">
      <PageHeader
        title="Proyectos y acceso"
        description="Gestiona quién puede ver y trabajar en cada proyecto."
        actions={
          <button
            onClick={() => setCreateOpen(true)}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium"
          >
            <Plus className="h-4 w-4" />
            Nuevo proyecto
          </button>
        }
      />

      {loading ? (
        <div className="bg-white rounded-xl border p-8 text-sm text-slate-500 flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Cargando…
        </div>
      ) : projects.length === 0 ? (
        <div className="bg-white rounded-xl border p-10 text-center text-sm text-slate-500">
          Aún no hay proyectos.{" "}
          <button onClick={() => setCreateOpen(true)} className="text-brand-600 underline">
            Crea el primero
          </button>
          .
        </div>
      ) : (
        <div className="bg-white rounded-xl border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="text-left px-5 py-3">Proyecto</th>
                <th className="text-left px-3 py-3">Cliente</th>
                <th className="text-left px-3 py-3">Tareas</th>
                <th className="text-left px-3 py-3">Acceso</th>
                <th className="text-right px-5 py-3">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {projects.map((p) => (
                <tr key={p.id} className="hover:bg-slate-50">
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-3">
                      <span className={`h-3 w-3 rounded-full ${p.color}`} />
                      <div>
                        <div className="font-medium">{p.name}</div>
                        {p.description && (
                          <div className="text-xs text-slate-500 line-clamp-1 max-w-md">{p.description}</div>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-3 text-slate-600">{p.client?.name ?? "—"}</td>
                  <td className="px-3 py-3 text-slate-600">{p._count.tasks}</td>
                  <td className="px-3 py-3">
                    {p._count.members === 0 ? (
                      <span className="inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-md border bg-amber-50 text-amber-800 border-amber-200">
                        <Globe2 className="h-3 w-3" />
                        Abierto a todos
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-md border bg-sky-50 text-sky-700 border-sky-200">
                        <Users className="h-3 w-3" />
                        {p._count.members} {p._count.members === 1 ? "miembro" : "miembros"}
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-3 text-right">
                    <button
                      onClick={() => setManagingProject(p)}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs text-slate-700 hover:bg-slate-100"
                    >
                      <UserPlus className="h-3.5 w-3.5" />
                      Acceso
                    </button>
                    <Link
                      href={`/tareas?project=${p.id}`}
                      className="ml-1 inline-flex items-center gap-1 px-2 py-1 rounded text-xs text-slate-600 hover:bg-slate-100"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      Ver
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-4 text-xs text-slate-500 leading-relaxed">
        Un proyecto sin miembros añadidos es <strong>visible para todo el workspace</strong> (compatibilidad
        con proyectos previos). Cuando añades el primer miembro, el proyecto pasa a ser <strong>privado</strong>
        y sólo los listados (más los administradores del workspace) lo verán.
      </p>

      <ProjectFormModal open={createOpen} onClose={() => setCreateOpen(false)} clients={clients} />
      {managingProject && (
        <ProjectMembersModal
          project={managingProject}
          allUsers={users}
          onClose={() => {
            setManagingProject(null);
            load(); // refrescar conteos
          }}
        />
      )}
    </div>
  );
}

function ProjectMembersModal({
  project,
  allUsers,
  onClose
}: {
  project: ProjectRow;
  allUsers: WorkspaceUser[];
  onClose: () => void;
}) {
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);

  async function loadMembers() {
    setLoading(true);
    try {
      const r = await fetch(`/api/v1/projects/${project.id}/members`);
      if (r.ok) setMembers((await r.json()).items ?? []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadMembers();
  }, [project.id]);

  async function addMember(userId: string) {
    setAdding(true);
    const r = await fetch(`/api/v1/projects/${project.id}/members`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, role: "MEMBER" })
    });
    setAdding(false);
    if (r.ok) loadMembers();
    else alert("No se pudo añadir");
  }

  async function removeMember(userId: string) {
    if (!confirm("¿Quitar acceso a este usuario?")) return;
    const r = await fetch(`/api/v1/projects/${project.id}/members/${userId}`, {
      method: "DELETE"
    });
    if (r.ok) loadMembers();
    else alert("No se pudo quitar");
  }

  const memberIds = new Set(members.map((m) => m.id));
  const candidates = allUsers.filter((u) => !memberIds.has(u.id));

  return (
    <Modal open={true} onClose={onClose} title={`Acceso a "${project.name}"`} size="lg">
      <div className="space-y-5">
        <div>
          <h3 className="text-xs uppercase tracking-wide text-slate-500 font-semibold mb-2">
            Con acceso ({members.length})
          </h3>
          {loading ? (
            <div className="text-sm text-slate-500 flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" /> Cargando…
            </div>
          ) : members.length === 0 ? (
            <div className="text-sm text-slate-500 italic bg-amber-50 border border-amber-200 rounded-lg p-3">
              Nadie está añadido todavía → el proyecto es visible para todo el workspace.
              Añade al menos un miembro para hacerlo privado.
            </div>
          ) : (
            <ul className="space-y-1.5">
              {members.map((m) => (
                <li key={m.id} className="flex items-center gap-3 bg-slate-50 rounded-lg p-2.5">
                  <div className="h-8 w-8 rounded-full bg-brand-500 text-white grid place-items-center text-xs font-semibold">
                    {(m.name || m.email).slice(0, 2).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium">{m.name || m.email}</div>
                    <div className="text-xs text-slate-500">{m.email}</div>
                  </div>
                  <button
                    onClick={() => removeMember(m.id)}
                    className="h-7 w-7 grid place-items-center rounded text-slate-400 hover:text-rose-600 hover:bg-rose-50"
                    title="Quitar acceso"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <h3 className="text-xs uppercase tracking-wide text-slate-500 font-semibold mb-2">
            Añadir del workspace
          </h3>
          {candidates.length === 0 ? (
            <p className="text-sm text-slate-500 italic">Todos los miembros del workspace ya tienen acceso.</p>
          ) : (
            <ul className="space-y-1.5">
              {candidates.map((u) => (
                <li key={u.id} className="flex items-center gap-3 bg-white border rounded-lg p-2.5">
                  <div className="h-8 w-8 rounded-full bg-slate-200 text-slate-600 grid place-items-center text-xs font-semibold">
                    {(u.name || u.email).slice(0, 2).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium">{u.name || u.email}</div>
                    <div className="text-xs text-slate-500">{u.email}</div>
                  </div>
                  <button
                    onClick={() => addMember(u.id)}
                    disabled={adding}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs bg-brand-600 hover:bg-brand-700 text-white disabled:opacity-50"
                  >
                    <UserPlus className="h-3.5 w-3.5" />
                    Dar acceso
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Modal>
  );
}
