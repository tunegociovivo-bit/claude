"use client";

import { useCallback, useEffect, useState } from "react";
import { Building2 } from "lucide-react";
import FacturasClient from "@/components/admin/FacturasClient";

type ClientLite = { id: string; name: string; taxId: string | null };
type Issuer = {
  id: string;
  name: string;
  legalName?: string | null;
  taxId: string;
  isDefault?: boolean;
  [k: string]: any;
};

const LS_KEY = "facturacion-empresa-v1";

export default function FacturacionClient({
  clients,
  initialIssuers
}: {
  clients: ClientLite[];
  initialIssuers: Issuer[];
}) {
  const [issuers, setIssuers] = useState<Issuer[]>(initialIssuers ?? []);
  const [selectedId, setSelectedId] = useState<string>("");

  // Selección inicial: localStorage → emisor por defecto → primero.
  useEffect(() => {
    const saved = (() => {
      try {
        return localStorage.getItem(LS_KEY) ?? "";
      } catch {
        return "";
      }
    })();
    const valid = issuers.find((i) => i.id === saved);
    const fallback = issuers.find((i) => i.isDefault) ?? issuers[0];
    setSelectedId(valid?.id ?? fallback?.id ?? "");
    // solo al montar
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function select(id: string) {
    setSelectedId(id);
    try {
      localStorage.setItem(LS_KEY, id);
    } catch {}
  }

  const refreshIssuers = useCallback(async () => {
    const r = await fetch("/api/v1/invoice-issuers", { cache: "no-store" });
    if (!r.ok) return;
    const list: Issuer[] = (await r.json()).items ?? [];
    setIssuers(list);
    // Si no había selección válida (p.ej. acaban de crear la primera), elige una.
    setSelectedId((cur) => {
      if (list.find((i) => i.id === cur)) return cur;
      const next = list.find((i) => i.isDefault) ?? list[0];
      if (next) {
        try {
          localStorage.setItem(LS_KEY, next.id);
        } catch {}
        return next.id;
      }
      return "";
    });
  }, []);

  const selected = issuers.find((i) => i.id === selectedId) ?? null;

  return (
    <div className="space-y-4">
      {/* Selector de empresa — lo primero de Facturación */}
      <div className="bg-white border rounded-xl p-4">
        <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
          <Building2 className="h-3.5 w-3.5" /> Empresa de facturación
        </label>
        {issuers.length === 0 ? (
          <div className="text-sm text-slate-600">
            Aún no tienes ninguna empresa emisora. Crea la primera con el botón{" "}
            <span className="inline-flex items-center gap-1 font-medium">
              <Building2 className="h-3.5 w-3.5" /> Emisores
            </span>{" "}
            de abajo para empezar a facturar.
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <select
              value={selectedId}
              onChange={(e) => select(e.target.value)}
              className="min-w-[260px] px-3 py-2 rounded-lg border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            >
              {issuers.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                  {i.taxId ? ` · ${i.taxId}` : ""}
                  {i.isDefault ? " (por defecto)" : ""}
                </option>
              ))}
            </select>
            {selected && (
              <span className="text-xs text-slate-500">
                Toda la facturación que gestiones aquí se emitirá desde{" "}
                <span className="font-medium text-slate-700">{selected.name}</span>.
              </span>
            )}
          </div>
        )}
      </div>

      {/* Gestor de facturas, limitado a la empresa elegida */}
      <FacturasClient
        key={selected?.id ?? "none"}
        clients={clients}
        initialIssuers={issuers as any}
        lockedIssuerId={selected?.id}
        onIssuersChanged={refreshIssuers}
      />
    </div>
  );
}
