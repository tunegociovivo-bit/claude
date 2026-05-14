"use client";

import { useState } from "react";
import ClientFormModal from "@/components/forms/ClientFormModal";

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
      <ClientFormModal open={editOpen} onClose={() => setEditOpen(false)} client={client} mode="edit" />
      <ClientFormModal open={notesOpen} onClose={() => setNotesOpen(false)} client={client} mode="notes" />
    </>
  );
}
