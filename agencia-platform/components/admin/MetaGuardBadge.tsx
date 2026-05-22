"use client";

import { useEffect, useState } from "react";
import { ShieldCheck, ShieldAlert, ShieldX } from "lucide-react";

type GuardState = {
  inCooldown: boolean;
  cooldownMsLeft: number;
  cooldownReason: string;
  lastUsagePct: number;
};

export default function MetaGuardBadge() {
  const [s, setS] = useState<GuardState | null>(null);

  useEffect(() => {
    let stop = false;
    const load = async () => {
      try {
        const r = await fetch("/api/v1/admin/meta/guard-status", { cache: "no-store" });
        if (r.ok && !stop) setS(await r.json());
      } catch {}
    };
    load();
    const id = setInterval(load, 30_000);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, []);

  if (!s) return null;

  const cooldown = s.inCooldown;
  const high = !cooldown && s.lastUsagePct >= 75;
  const min = Math.ceil(s.cooldownMsLeft / 60000);

  const tone = cooldown
    ? "bg-rose-50 border-rose-200 text-rose-700"
    : high
      ? "bg-amber-50 border-amber-200 text-amber-700"
      : "bg-emerald-50 border-emerald-200 text-emerald-700";
  const Icon = cooldown ? ShieldX : high ? ShieldAlert : ShieldCheck;

  return (
    <div className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-sm mb-4 ${tone}`}>
      <Icon className="h-4 w-4 shrink-0" />
      <div>
        <span className="font-medium">Guardián Meta Ads: </span>
        {cooldown ? (
          <>
            en enfriamiento ~{min} min (Meta está limitando la cuenta — no se publica hasta que pase).
            {s.cooldownReason ? ` Motivo: ${s.cooldownReason}.` : ""}
          </>
        ) : (
          <>
            activo y sin bloqueos. Uso de cuota Meta: {Math.round(s.lastUsagePct)}%
            {high ? " (alto — ralentizando escrituras)." : "."}
          </>
        )}
      </div>
    </div>
  );
}
