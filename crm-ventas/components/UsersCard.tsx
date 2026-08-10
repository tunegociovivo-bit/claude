"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { Trash2 } from "lucide-react";

type User = {
  id: string;
  email: string;
  name: string | null;
  role: string;
  createdAt: string;
};

// Gestión de usuarios del workspace ACTUAL (solo administradores). El
// workspace lo decide siempre el servidor a partir de la sesión.
export default function UsersCard() {
  const [users, setUsers] = useState<User[] | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const res = await fetch("/api/v1/settings/users", { cache: "no-store" });
    if (res.status === 401 || res.status === 403) {
      setForbidden(true);
      return;
    }
    const data = await res.json().catch(() => null);
    if (res.ok) setUsers(data.users);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function createUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      const res = await fetch("/api/v1/settings/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: form.get("email"),
          name: form.get("name") || undefined,
          password: form.get("password"),
          role: form.get("role"),
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "No se pudo crear el usuario");
      (event.target as HTMLFormElement).reset();
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo crear el usuario");
    } finally {
      setBusy(false);
    }
  }

  async function removeUser(user: User) {
    if (!confirm(`¿Eliminar el usuario ${user.email}? Perderá el acceso inmediatamente.`)) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/v1/settings/users/${user.id}`, { method: "DELETE" });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "No se pudo eliminar");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo eliminar");
    } finally {
      setBusy(false);
    }
  }

  if (forbidden) return null;

  return (
    <section className="card space-y-4 p-4 sm:p-6">
      <div>
        <h2 className="font-semibold">Usuarios</h2>
        <p className="text-xs text-slate-500">
          Personas con acceso a este negocio en el CRM.
        </p>
      </div>

      {users === null ? (
        <p className="text-sm text-slate-500">Cargando…</p>
      ) : (
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
          {users.map((u) => (
            <li key={u.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm sm:flex-nowrap sm:gap-3">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{u.name || u.email}</p>
                <p className="truncate text-xs text-slate-500">{u.email}</p>
              </div>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs">
                {u.role === "ADMIN" ? "Administrador" : "Miembro"}
              </span>
              <button
                type="button"
                className="btn-ghost text-red-500"
                title="Eliminar usuario"
                disabled={busy}
                onClick={() => removeUser(u)}
              >
                <Trash2 size={15} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <form className="grid gap-3 sm:grid-cols-2" onSubmit={createUser}>
        <input className="input" name="name" maxLength={120} placeholder="Nombre (opcional)" />
        <input className="input" name="email" type="email" required placeholder="email@negocio.com" />
        <input
          className="input"
          name="password"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          placeholder="Contraseña (mínimo 8 caracteres)"
        />
        <select className="input" name="role" defaultValue="MEMBER">
          <option value="MEMBER">Miembro</option>
          <option value="ADMIN">Administrador</option>
        </select>
        {error && <p className="text-sm text-red-600 sm:col-span-2">{error}</p>}
        <div className="sm:col-span-2">
          <button className="btn-primary" disabled={busy} type="submit">
            {busy ? "Un momento…" : "Crear usuario"}
          </button>
        </div>
      </form>
    </section>
  );
}
