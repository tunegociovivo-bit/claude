"use client";

import { useCallback, useEffect, useState } from "react";
import clsx from "clsx";
import { KanbanSquare, MessageCircle } from "lucide-react";
import PipelineClient from "./PipelineClient";
import InboxPanel from "@/components/inbox/InboxPanel";
import type { PipelineColumn } from "@/lib/settings";

type View = "tablero" | "whatsapp";

export default function PipelineWorkspace({
  columns,
  initialCards,
  initialView,
  initialContactId,
}: {
  columns: PipelineColumn[];
  initialCards: React.ComponentProps<typeof PipelineClient>["initialCards"];
  initialView: View;
  initialContactId: string | null;
}) {
  const [view, setView] = useState<View>(initialView);
  const [contactId, setContactId] = useState<string | null>(initialContactId);
  const [openKey, setOpenKey] = useState(0);
  const [unread, setUnread] = useState(0);

  const switchView = useCallback((next: View, contact: string | null = null) => {
    setView(next);
    setContactId(contact);
    if (contact) setOpenKey((k) => k + 1);
    const url = new URL(window.location.href);
    if (next === "whatsapp") url.searchParams.set("vista", "whatsapp");
    else url.searchParams.delete("vista");
    if (contact) url.searchParams.set("contacto", contact);
    else url.searchParams.delete("contacto");
    window.history.replaceState(null, "", url.toString());
  }, []);

  // Contador de chats sin leer en la pestaña (sondeo ligero).
  useEffect(() => {
    let alive = true;
    const load = async () => {
      if (document.visibilityState !== "visible") return;
      const res = await fetch("/api/v1/inbox/conversations?summary=1", { cache: "no-store" }).catch(() => null);
      const data = res?.ok ? await res.json().catch(() => null) : null;
      if (alive && data?.totals) setUnread(data.totals.unreadChats ?? 0);
    };
    void load();
    const t = setInterval(load, 15000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  return (
    <div>
      <div className="mb-3 inline-flex rounded-xl bg-slate-200/70 p-1" role="tablist" aria-label="Vista del pipeline">
        {(
          [
            { id: "tablero", label: "Tablero", icon: KanbanSquare },
            { id: "whatsapp", label: "WhatsApp unificado", icon: MessageCircle },
          ] as const
        ).map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            role="tab"
            aria-selected={view === id}
            onClick={() => switchView(id)}
            className={clsx(
              "flex min-h-9 items-center gap-2 rounded-lg px-3 text-sm font-medium transition-colors",
              view === id ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"
            )}
          >
            <Icon size={15} />
            {label}
            {id === "whatsapp" && unread > 0 && (
              <span className="rounded-full bg-emerald-500 px-1.5 text-[11px] font-semibold text-white">{unread}</span>
            )}
          </button>
        ))}
      </div>

      {view === "tablero" ? (
        <PipelineClient columns={columns} initialCards={initialCards} onOpenChat={(id) => switchView("whatsapp", id)} />
      ) : (
        <InboxPanel
          columns={columns}
          openContactId={contactId}
          openRequestKey={openKey}
          onOpenBoard={() => switchView("tablero")}
          title="WhatsApp unificado"
          hideTitleOnMobile
          onUnreadChange={setUnread}
          heightClass="h-[calc(100dvh-13.5rem)] md:h-[calc(100vh-6.5rem)]"
        />
      )}
    </div>
  );
}
