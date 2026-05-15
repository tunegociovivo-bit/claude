"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2, Loader2, AlertTriangle } from "lucide-react";
import ClientFormModal from "@/components/forms/ClientFormModal";
import Modal from "@/components/ui/Modal";

type ClientLite = {
  id: string;
  name: string;
  industry?: string;
  status?: any;
  contactName?: string;
  email?: string;
  phone?: string;
  mrr?: number;
  notes?: string;
};

export default function ClienteDetailActions({ client }: { client: ClientLite }) {
  const [editOpen, setEditOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setEditOpen(true)}
        className="px-3 py-2 rounded-lg bg-white border text-sm hover:bg-slate-50"
      >
        Editar
      </button>
      <button
        onClick={() => setNotesOpen(true)}
        className="px-3 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium"
      >
        Editar notas
      </button>
      <button
        onClick={() => setDeleteOpen(true)}
        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-rose-600 hover:bg-rose-50 text-sm"
        title="Eliminar cliente"
      >
        <Trash2 className="h-4 w-4" />
        Eliminar
      </button>
      <ClientFormModal open={editOpen} onClose={() => setEditOpen(false)} client={client} mode="edit" />
      <ClientFormModal open={notesOpen} onClose={() => setNotesOpen(false)} client={client} mode="notes" />
      <DeleteClientModal open={deleteOpen} onClose={() => setDeleteOpen(false)} client={client} />
    </>
  );
}

function DeleteClientModal({
  open,
  onClose,
  client
}: {
  open: boolean;
  onClose: () => void;
  client: ClientLite;
}) {
  const router = useRouter();
  const [stage, setStage] = useState<1 | 2>(1);
  const [confirmName, setConfirmName] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameOk = confirmName.trim() === client.name;

  async function doDelete() {
    setDeleting(true);
    setError(null);
    try {
      const r = await fetch(`/api/v1/clients/${client.id}`, { method: "DELETE" });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j?.error?.message ?? `Error ${r.status}`);
      }
      router.push("/clientes");
      router.refresh();
    } catch (e: any) {
      setError(e.message ?? String(e));
      setDeleting(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={() => { setStage(1); setConfirmName(""); setError(null); onClose(); }}
      title={stage === 1 ? "Confirmación 1 de 2" : "Confirmación 2 de 2 — última oportunidad"}
      size="md"
      footer={
        <>
          <button
            type="button"
            onClick={() => { setStage(1); setConfirmName(""); setError(null); onClose(); }}
            className="px-3 py-2 rounded-lg text-sm border bg-white hover:bg-slate-50"
          >
            Cancelar
          </button>
          {stage === 1 ? (
            <button
              type="button"
              onClick={() => setStage(2)}
              className="px-3 py-2 rounded-lg text-sm font-medium bg-rose-100 text-rose-700 hover:bg-rose-200"
            >
              Entiendo, continuar
            </button>
          ) : (
            <button
              type="button"
              onClick={doDelete}
              disabled={!nameOk || deleting}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-rose-600 hover:bg-rose-700 text-white disabled:opacity-50"
            >
              {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              Eliminar definitivamente
            </button>
          )}
        </>
      }
    >
      {stage === 1 ? (
        <div className="space-y-3">
          <div className="flex items-start gap-3 p-3 rounded-lg bg-rose-50 border border-rose-200">
            <AlertTriangle className="h-5 w-5 text-rose-600 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-rose-900">
                Vas a eliminar el cliente "{client.name}".
              </p>
              <ul className="mt-2 text-xs text-rose-800 list-disc ml-5 space-y-0.5">
                <li>El cliente se marca como eliminado (soft-delete) y deja de aparecer en listados y selectores.</li>
                <li>Sus proyectos NO se borran automáticamente, pero quedan sin cliente asociado.</li>
                <li>Sus eventos y tareas quedan sin cliente asociado.</li>
                <li>Las publicaciones editoriales del cliente quedan sin cliente asociado.</li>
                <li>Si te arrepientes, podemos restaurarlo manualmente en BD (no se borra del todo).</li>
              </ul>
            </div>
          </div>
          <p className="text-sm text-slate-600">
            ¿Estás seguro? Si lo estás, pulsa "Entiendo, continuar" para una segunda confirmación.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-slate-700">
            Para confirmar el borrado, <strong>escribe el nombre del cliente exactamente</strong>:
          </p>
          <div className="px-3 py-2 rounded-lg bg-slate-100 font-mono text-sm">{client.name}</div>
          <input
            value={confirmName}
            onChange={(e) => setConfirmName(e.target.value)}
            autoFocus
            placeholder="Escribe el nombre del cliente"
            className="w-full px-3 py-2 rounded-lg border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-rose-500"
          />
          {confirmName && !nameOk && (
            <p className="text-xs text-rose-600">El nombre no coincide.</p>
          )}
          {error && <p className="text-xs text-rose-600">{error}</p>}
        </div>
      )}
    </Modal>
  );
}
