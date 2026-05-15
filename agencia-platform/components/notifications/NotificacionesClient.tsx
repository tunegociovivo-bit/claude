"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import PageHeader from "@/components/PageHeader";
import { Bell, Loader2, Check, X, MessageSquare } from "lucide-react";
import clsx from "clsx";

type Notification = {
  id: string;
  type: string;
  body: string;
  link: string | null;
  read: boolean;
  createdAt: string;
};

export default function NotificacionesClient() {
  const [items, setItems] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const r = await fetch("/api/v1/notifications");
      if (r.ok) setItems((await r.json()).items ?? []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function markRead(id: string) {
    await fetch(`/api/v1/notifications/${id}`, { method: "PATCH" });
    setItems((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
  }

  async function dismiss(id: string) {
    await fetch(`/api/v1/notifications/${id}`, { method: "DELETE" });
    setItems((prev) => prev.filter((n) => n.id !== id));
  }

  async function markAllRead() {
    await fetch("/api/v1/notifications", { method: "PATCH" });
    setItems((prev) => prev.map((n) => ({ ...n, read: true })));
  }

  const unreadCount = items.filter((n) => !n.read).length;

  return (
    <div className="max-w-3xl mx-auto">
      <PageHeader
        title="Notificaciones"
        description={unreadCount > 0 ? `${unreadCount} sin leer` : "Estás al día"}
        actions={
          unreadCount > 0 ? (
            <button
              onClick={markAllRead}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white border text-sm hover:bg-slate-50"
            >
              <Check className="h-4 w-4" />
              Marcar todo como leído
            </button>
          ) : null
        }
      />

      {loading ? (
        <div className="bg-white rounded-xl border p-8 text-sm text-slate-500 flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Cargando…
        </div>
      ) : items.length === 0 ? (
        <div className="bg-white rounded-xl border p-10 text-center">
          <div className="h-12 w-12 rounded-full bg-slate-100 grid place-items-center mx-auto mb-3 text-slate-400">
            <Bell className="h-5 w-5" />
          </div>
          <p className="text-sm text-slate-600">Aún no tienes notificaciones.</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border divide-y">
          {items.map((n) => {
            const Icon = n.type === "mention" ? MessageSquare : Bell;
            return (
              <div
                key={n.id}
                className={clsx(
                  "p-4 flex items-start gap-3 group transition",
                  !n.read && "bg-brand-50/40"
                )}
              >
                <div
                  className={clsx(
                    "h-9 w-9 rounded-full grid place-items-center shrink-0",
                    n.read ? "bg-slate-100 text-slate-400" : "bg-brand-100 text-brand-600"
                  )}
                >
                  <Icon className="h-4 w-4" />
                </div>
                <div className="flex-1 min-w-0">
                  {n.link ? (
                    <Link
                      href={n.link}
                      onClick={() => markRead(n.id)}
                      className="text-sm font-medium hover:text-brand-600 block"
                    >
                      {n.body}
                    </Link>
                  ) : (
                    <p className="text-sm font-medium">{n.body}</p>
                  )}
                  <p className="text-xs text-slate-500 mt-0.5">
                    {new Date(n.createdAt).toLocaleString("es-ES", {
                      day: "2-digit",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit"
                    })}
                  </p>
                </div>
                <div className="opacity-0 group-hover:opacity-100 flex gap-1">
                  {!n.read && (
                    <button
                      onClick={() => markRead(n.id)}
                      className="h-7 w-7 grid place-items-center rounded text-slate-400 hover:text-brand-600 hover:bg-brand-50"
                      title="Marcar como leída"
                    >
                      <Check className="h-3.5 w-3.5" />
                    </button>
                  )}
                  <button
                    onClick={() => dismiss(n.id)}
                    className="h-7 w-7 grid place-items-center rounded text-slate-400 hover:text-rose-600 hover:bg-rose-50"
                    title="Borrar"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
