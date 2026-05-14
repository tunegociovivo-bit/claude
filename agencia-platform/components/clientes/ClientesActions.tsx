"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import ClientFormModal from "@/components/forms/ClientFormModal";

export default function ClientesActions() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium"
      >
        <Plus className="h-4 w-4" />
        Nuevo cliente
      </button>
      <ClientFormModal open={open} onClose={() => setOpen(false)} mode="create" />
    </>
  );
}
