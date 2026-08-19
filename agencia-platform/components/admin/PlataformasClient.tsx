"use client";

import { useEffect, useMemo, useState } from "react";
import PageHeader from "@/components/PageHeader";
import Modal from "@/components/ui/Modal";
import { Loader2, Users, ExternalLink, Lock, Globe2, Edit2 } from "lucide-react";

type PlatformCatalogItem = {
  key: string;
  label: string;
  description: string;
  href: string;
  available: boolean;
  pendingMessage?: string;
};

type PlatformConfig = { enabled: boolean; memberIds: string[]; restricted?: boolean; customLabel?: string; customDescription?: string };

type WorkspaceUser = { id: string; name: string | null; email: string };

export default function PlataformasClient() {
  const [catalog, setCatalog] = useState<PlatformCatalogItem[]>([]);
  const [config, setConfig] = useState<Record<string, PlatformConfig>>({});
  const [users, setUsers] = useState<WorkspaceUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [managing, setManaging] = useState<PlatformCatalogItem | null>(null);
  const [renaming, setRenaming] = useState<PlatformCatalogItem | null>(null);

  async function load() {
    setLoading(true);
    const [pr, ur] = await Promise.all([
      fetch("/api/v1/admin/platforms"),
      fetch("/api/v1/users")
    ]);
    if (pr.ok) {
      const d = await pr.json();
      setCatalog(d.catalog ?? []);
      setConfig(d.config ?? {});
    }
    if (ur.ok) {
      const d = await ur.json();
      setUsers(
        (d.items ?? []).map((u: any) => ({ id: u.id, name: u.name, email: u.email }))
      );
    }
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function toggleEnabled(key: string, enabled: boolean) {
    setSavingKey(key);
    const r = await fetch("/api/v1/admin/platforms", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, enabled })
    });
    setSavingKey(null);
    if (r.ok) {
      const d = await r.json();
      setConfig(d.config ?? {});
    }
  }

  async function updateMembers(key: string, memberIds: string[], restricted = true) {
    setSavingKey(key);
    const r = await fetch("/api/v1/admin/platforms", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, memberIds, restricted })
    });
    setSavingKey(null);
    if (r.ok) {
      const d = await r.json();
      setConfig(d.config ?? {});
    }
  }

  async function updateNaming(key: string, customLabel: string | null, customDescription: string | null) {
    setSavingKey(key);
    const r = await fetch("/api/v1/admin/platforms", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, customLabel, customDescription })
    });
    setSavingKey(null);
    if (r.ok) {
      const d = await r.json();
      setConfig(d.config ?? {});
    }
  }

  return (
    <div className="max-w-4xl mx-auto">
      <PageHeader
        title="Plataformas"
        description="Activa las herramientas que aparecerán en el sidebar y decide qué trabajadores las ven."
      />

      {loading ? (
        <div className="bg-white rounded-xl border p-8 text-sm text-slate-500 flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Cargando…
        </div>
      ) : (
        <div className="space-y-3">
          {catalog.map((p) => {
            const c = config[p.key] ?? { enabled: false, memberIds: [] };
            const memberCount = c.memberIds?.length ?? 0;
            const isPrivate = !!c.restricted || memberCount > 0;
            const effectiveLabel = c.customLabel?.trim() || p.label;
            const effectiveDescription = c.customDescription?.trim() || (p.available ? p.description : p.pendingMessage ?? p.description);
            return (
              <div
                key={p.key}
                className="bg-white rounded-xl border p-4 flex items-start gap-4"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-medium text-[15px]">{effectiveLabel}</h3>
                    {c.customLabel && (
                      <span className="text-[10px] text-slate-400" title={`Original: ${p.label}`}>
                        (original: {p.label})
                      </span>
                    )}
                    {!p.available && (
                      <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-200 font-semibold">
                        Pendiente migrar
                      </span>
                    )}
                    {p.available && c.enabled && !isPrivate && (
                      <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-sky-50 text-sky-700 border border-sky-200 font-semibold inline-flex items-center gap-1">
                        <Globe2 className="h-2.5 w-2.5" />
                        Todo el equipo
                      </span>
                    )}
                    {p.available && c.enabled && isPrivate && (
                      <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-violet-50 text-violet-700 border border-violet-200 font-semibold inline-flex items-center gap-1">
                        <Lock className="h-2.5 w-2.5" />
                        {memberCount === 0 ? "Sin trabajadores" : `${memberCount} ${memberCount === 1 ? "trabajador" : "trabajadores"}`}
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-slate-600 mt-1">{effectiveDescription}</p>
                  {p.available && c.enabled && (
                    <a
                      href={p.href}
                      className="inline-flex items-center gap-1 text-xs text-brand-600 hover:underline mt-2"
                    >
                      Abrir {effectiveLabel}
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => setRenaming(p)}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs bg-white border hover:bg-slate-50"
                    title="Editar nombre y descripción"
                  >
                    <Edit2 className="h-3.5 w-3.5" />
                    Renombrar
                  </button>
                  {p.available && c.enabled && (
                    <button
                      onClick={() => setManaging(p)}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs bg-white border hover:bg-slate-50"
                    >
                      <Users className="h-3.5 w-3.5" />
                      Acceso
                    </button>
                  )}
                  <Toggle
                    checked={c.enabled}
                    disabled={!p.available || savingKey === p.key}
                    onChange={(v) => toggleEnabled(p.key, v)}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}

      <p className="mt-6 text-xs text-slate-500 leading-relaxed">
        <strong>Acceso vacío</strong> (sin trabajadores listados) = visible para todo el workspace. Añade
        trabajadores específicos para hacerla privada (los administradores siempre la ven).
      </p>

      {managing && (
        <PlatformMembersModal
          platform={managing}
          allUsers={users}
          currentMemberIds={config[managing.key]?.memberIds ?? []}
          onClose={() => setManaging(null)}
          onSave={async (ids, restricted) => {
            await updateMembers(managing.key, ids, restricted);
            setManaging(null);
          }}
        />
      )}

      {renaming && (
        <RenamePlatformModal
          platform={renaming}
          currentLabel={config[renaming.key]?.customLabel ?? ""}
          currentDescription={config[renaming.key]?.customDescription ?? ""}
          onClose={() => setRenaming(null)}
          onSave={async (label, description) => {
            await updateNaming(renaming.key, label, description);
            setRenaming(null);
          }}
        />
      )}
    </div>
  );
}

function RenamePlatformModal({
  platform,
  currentLabel,
  currentDescription,
  onClose,
  onSave
}: {
  platform: PlatformCatalogItem;
  currentLabel: string;
  currentDescription: string;
  onClose: () => void;
  onSave: (label: string | null, description: string | null) => Promise<void>;
}) {
  const [label, setLabel] = useState(currentLabel);
  const [description, setDescription] = useState(currentDescription);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    await onSave(
      label.trim() === "" ? null : label.trim(),
      description.trim() === "" ? null : description.trim()
    );
    setSaving(false);
  }

  return (
    <Modal
      open={true}
      onClose={onClose}
      title={`Renombrar "${platform.label}"`}
      size="lg"
      footer={
        <>
          <button onClick={onClose} className="px-3 py-2 rounded-lg text-sm border bg-white hover:bg-slate-50">Cancelar</button>
          <button
            onClick={save}
            disabled={saving}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium disabled:opacity-50"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Guardar
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-xs text-slate-500">
          Cambia el nombre con el que aparece esta herramienta en el sidebar y en este panel.
          El nombre original (<strong>{platform.label}</strong>) se mantiene como fallback.
        </p>
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">
            Nombre personalizado <span className="text-slate-400 font-normal">(dejar vacío usa el original)</span>
          </label>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            autoFocus
            maxLength={60}
            placeholder={platform.label}
            className="w-full px-3 py-2 rounded-lg border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">
            Descripción personalizada <span className="text-slate-400 font-normal">(opcional)</span>
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            maxLength={300}
            placeholder={platform.description}
            className="w-full px-3 py-2 rounded-lg border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>
      </div>
    </Modal>
  );
}

function Toggle({
  checked,
  disabled,
  onChange
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={
        "relative inline-flex h-6 w-11 items-center rounded-full transition " +
        (checked ? "bg-brand-600" : "bg-slate-300") +
        " disabled:opacity-40 disabled:cursor-not-allowed"
      }
    >
      <span
        className={
          "inline-block h-4 w-4 transform rounded-full bg-white transition " +
          (checked ? "translate-x-6" : "translate-x-1")
        }
      />
    </button>
  );
}

function PlatformMembersModal({
  platform,
  allUsers,
  currentMemberIds,
  onClose,
  onSave
}: {
  platform: PlatformCatalogItem;
  allUsers: WorkspaceUser[];
  currentMemberIds: string[];
  onClose: () => void;
  onSave: (memberIds: string[], restricted: boolean) => Promise<void>;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set(currentMemberIds));
  const [saving, setSaving] = useState(false);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function save() {
    setSaving(true);
    await onSave(Array.from(selected), true);
    setSaving(false);
  }

  return (
    <Modal
      open={true}
      onClose={onClose}
      title={`Acceso a "${platform.label}"`}
      size="lg"
      footer={
        <>
          <button
            type="button"
            onClick={async () => {
              setSaving(true);
              await onSave([], false);
              setSaving(false);
            }}
            className="mr-auto px-3 py-2 rounded-lg text-sm text-slate-600 hover:bg-slate-50"
          >
            Hacer pública (todo el workspace)
          </button>
          <button type="button" onClick={onClose} className="px-3 py-2 rounded-lg text-sm border bg-white hover:bg-slate-50">
            Cancelar
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium disabled:opacity-50"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Guardar
          </button>
        </>
      }
    >
      <p className="text-sm text-slate-600 mb-3">
        Marca a los trabajadores que pueden ver y usar <strong>{platform.label}</strong>. Los administradores siempre la ven.
        Si no marcas a nadie, la plataforma queda visible para todo el workspace.
      </p>
      <div className="space-y-1.5 max-h-[400px] overflow-y-auto">
        {allUsers.map((u) => {
          const isSel = selected.has(u.id);
          return (
            <label
              key={u.id}
              className={
                "flex items-center gap-3 p-2.5 rounded-lg cursor-pointer transition " +
                (isSel ? "bg-brand-50" : "bg-white hover:bg-slate-50 border")
              }
            >
              <input
                type="checkbox"
                checked={isSel}
                onChange={() => toggle(u.id)}
              />
              <div className="h-8 w-8 rounded-full bg-brand-500 text-white grid place-items-center text-xs font-semibold">
                {(u.name || u.email).slice(0, 2).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium">{u.name || u.email}</div>
                <div className="text-xs text-slate-500">{u.email}</div>
              </div>
            </label>
          );
        })}
        {allUsers.length === 0 && (
          <p className="text-sm text-slate-500 italic">No hay otros miembros en el workspace. Añade trabajadores en <a href="/admin/usuarios" className="underline">/admin/usuarios</a>.</p>
        )}
      </div>
    </Modal>
  );
}
