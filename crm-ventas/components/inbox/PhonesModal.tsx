"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import clsx from "clsx";
import {
  Brain,
  ChevronDown,
  Link2,
  Loader2,
  Lock,
  LockOpen,
  Plus,
  QrCode,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  Trash2,
  X,
} from "lucide-react";
import { useAgentName } from "@/components/AgentNameContext";
import { formatPhone, jsonFetch, lineStatusText, RiskBadge, StatusDot } from "@/components/inbox/ui";

type LineDetail = {
  id: string;
  label: string;
  sessionName?: string;
  mode: "own" | "linked";
  isPrimary: boolean;
  legacySession: boolean;
  phone: string | null;
  active: boolean;
  aiMode: "auto" | "suggest" | "off";
  instructions: string;
  dailyLimit: number;
  hourlyLimit: number;
  newChatsPerDay: number;
  newChatsCapToday: number;
  warmupDays: number;
  lastStatus: string | null;
  pausedUntil: string | null;
  pauseReason: string | null;
  usage: { sentToday: number; sent24h: number; failed24h: number; coldToday: number; queued: number; optOuts7d: number };
  risk: { score: number; level: "bajo" | "medio" | "alto"; reasons: string[] };
};

type Learning = {
  styleGuide: string;
  locked: boolean;
  refreshedAt: string | null;
  pendingSamples: number;
  stats: {
    accepted: number;
    edited: number;
    rewritten: number;
    written: number;
    phone: number;
    total: number;
    acceptanceRate: number | null;
    usefulRate: number | null;
  };
  recentCorrections: { id: string; customerText: string; aiDraft: string | null; finalText: string; outcome: string }[];
};

const MODES: { id: LineDetail["aiMode"]; label: string; hint: string }[] = [
  { id: "auto", label: "Responde sola", hint: "contesta automáticamente" },
  { id: "suggest", label: "Propone", hint: "tú revisas y envías" },
  { id: "off", label: "Apagada", hint: "sin IA en este número" },
];

function QrBox({ lineId, onConnected }: { lineId: string; onConnected: () => void }) {
  const [key, setKey] = useState(0);
  const [status, setStatus] = useState<string | null>(null);
  useEffect(() => {
    const t = setInterval(async () => {
      setKey((k) => k + 1);
      const { ok, data } = await jsonFetch(`/api/v1/inbox/lines`);
      if (!ok) return;
      const line = (data.lines as LineDetail[]).find((l) => l.id === lineId);
      setStatus(line?.lastStatus ?? null);
      if (line?.lastStatus === "WORKING") onConnected();
    }, 4000);
    return () => clearInterval(t);
  }, [lineId, onConnected]);
  return (
    <div className="mt-3 flex flex-col items-center gap-2 rounded-lg bg-slate-50 p-4">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        key={key}
        src={`/api/v1/inbox/lines/${lineId}/qr?t=${key}`}
        alt="Código QR para vincular WhatsApp"
        className="h-52 w-52 rounded-md bg-white p-2"
        onError={(e) => ((e.target as HTMLImageElement).style.opacity = "0.2")}
      />
      <p className="max-w-xs text-center text-xs text-slate-500">
        En el móvil: WhatsApp → Dispositivos vinculados → Vincular dispositivo, y escanea el código. Se renueva solo.
        {status && status !== "SCAN_QR_CODE" ? ` Estado: ${status}.` : ""}
      </p>
    </div>
  );
}

function LineCard({
  line,
  canManage,
  isOperator,
  onChanged,
  agentName,
}: {
  line: LineDetail;
  canManage: boolean;
  isOperator: boolean;
  onChanged: () => Promise<void>;
  agentName: string;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showQr, setShowQr] = useState(line.lastStatus === "SCAN_QR_CODE");
  const [form, setForm] = useState({
    label: line.label,
    instructions: line.instructions,
    dailyLimit: line.dailyLimit,
    hourlyLimit: line.hourlyLimit,
    newChatsPerDay: line.newChatsPerDay,
  });

  useEffect(() => {
    if (line.lastStatus === "SCAN_QR_CODE") setShowQr(true);
  }, [line.lastStatus]);

  async function patch(body: Record<string, unknown>) {
    setBusy(true);
    setError("");
    const { ok, data } = await jsonFetch(`/api/v1/inbox/lines/${line.id}`, { method: "PATCH", body: JSON.stringify(body) });
    if (!ok) setError(typeof data?.error === "string" ? data.error : "No se pudo guardar");
    await onChanged();
    setBusy(false);
  }

  async function connect(migrate = false) {
    if (
      line.lastStatus === "WORKING" &&
      !migrate &&
      !confirm("Se reiniciará la sesión de WhatsApp de este número (unos segundos sin recibir mensajes). ¿Continuar?")
    ) {
      return;
    }
    if (
      migrate &&
      !confirm(
        "Este número usa una sesión antigua. Se creará una sesión propia del negocio y tendrás que escanear un QR nuevo con el móvil. Hasta entonces la IA no podrá responder (los mensajes que lleguen se seguirán guardando). ¿Continuar?"
      )
    ) {
      return;
    }
    setBusy(true);
    setError("");
    const { ok, data } = await jsonFetch(`/api/v1/inbox/lines/${line.id}/connect`, {
      method: "POST",
      body: migrate ? JSON.stringify({ migrate: true }) : undefined,
    });
    if (!ok) setError(data?.error ?? "No se pudo generar el QR");
    else setShowQr(data?.connection?.status !== "WORKING");
    await onChanged();
    setBusy(false);
  }

  async function unlink() {
    if (!confirm("Se desvinculará el móvil de este número y podrás escanear otro QR. ¿Continuar?")) return;
    setBusy(true);
    const { ok, data } = await jsonFetch(`/api/v1/inbox/lines/${line.id}/connect`, { method: "DELETE" });
    if (!ok) setError(data?.error ?? "No se pudo desvincular");
    await onChanged();
    setBusy(false);
  }

  async function remove(force = false) {
    if (!force && !confirm(`¿Quitar «${line.label}» de la bandeja?${line.mode === "own" ? " Se desvinculará el móvil." : " El número seguirá funcionando en su sistema."}`)) return;
    setBusy(true);
    const { ok, data } = await jsonFetch(`/api/v1/inbox/lines/${line.id}${force ? "?force=1" : ""}`, { method: "DELETE" });
    setBusy(false);
    if (!ok) {
      if (data?.canForce && confirm(`${data.error}\n\n¿Quitarlo igualmente del CRM?`)) return remove(true);
      setError(data?.error ?? "No se pudo quitar");
      return;
    }
    await onChanged();
  }

  const paused = Boolean(line.pausedUntil);
  const manageable = canManage && line.mode === "own";

  return (
    <div className={clsx("rounded-xl border p-3 sm:p-4", line.active ? "border-slate-200" : "border-slate-200 bg-slate-50 opacity-80")}>
      <div className="flex flex-wrap items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
          <Smartphone size={18} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-semibold">{line.label}</span>
            {line.isPrimary && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">Principal</span>}
            {line.mode === "linked" && (
              <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-medium text-indigo-700">Enlazado</span>
            )}
            <RiskBadge level={line.risk.level} score={line.risk.score} />
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-slate-500">
            <span className="inline-flex items-center gap-1">
              <StatusDot status={line.lastStatus} paused={paused} active={line.active} />
              {lineStatusText({ lastStatus: line.lastStatus, active: line.active, pausedUntil: line.pausedUntil })}
            </span>
            {line.phone && <span>{formatPhone(line.phone)}</span>}
            {isOperator && line.sessionName && <span className="font-mono text-[10px] text-slate-400">{line.sessionName}</span>}
          </div>
          <div className="mt-1 text-xs text-slate-500">
            Hoy {line.usage.sentToday}/{line.dailyLimit} enviados
            {line.usage.queued > 0 ? ` · ${line.usage.queued} en cola` : ""}
            {line.usage.failed24h > 0 ? ` · ${line.usage.failed24h} fallidos (24 h)` : ""}
            {line.usage.optOuts7d > 0 ? ` · ${line.usage.optOuts7d} ${line.usage.optOuts7d === 1 ? "baja" : "bajas"} (7 días)` : ""}
          </div>
          {line.risk.reasons.length > 0 && line.risk.level !== "bajo" && (
            <div className="mt-1 text-[11px] text-amber-700">{line.risk.reasons.join(" · ")}</div>
          )}
        </div>
      </div>

      {paused && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg bg-orange-50 p-2.5 text-xs text-orange-800">
          <span>
            En pausa de seguridad hasta las{" "}
            {new Date(line.pausedUntil!).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}
            {line.pauseReason ? `: ${line.pauseReason}` : ""}.
          </span>
          {canManage && (
            <button className="ml-auto font-semibold underline" disabled={busy} onClick={() => void patch({ resume: true })}>
              Reanudar ya
            </button>
          )}
        </div>
      )}

      <div className="mt-3">
        <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-slate-500">IA ({agentName}) en este número</div>
        <div className="grid grid-cols-3 gap-1 rounded-lg bg-slate-100 p-1">
          {MODES.map((m) => (
            <button
              key={m.id}
              disabled={!canManage || busy}
              onClick={() => void patch({ aiMode: m.id })}
              className={clsx(
                "rounded-md px-2 py-1.5 text-xs font-medium transition-colors",
                line.aiMode === m.id ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800",
                !canManage && "cursor-not-allowed"
              )}
              title={m.hint}
            >
              {m.label}
            </button>
          ))}
        </div>
        <p className="mt-1 text-[11px] text-slate-500">
          {line.aiMode === "auto"
            ? `${agentName} contesta sola con ritmo humano. Si una persona responde, se aparta de ese chat 2 h.`
            : line.aiMode === "suggest"
              ? `${agentName} deja una propuesta en cada chat; tú decides si enviarla, editarla o escribir otra (y aprende de ello).`
              : "Sin propuestas ni respuestas automáticas."}
        </p>
      </div>

      {showQr && line.mode === "own" && canManage && line.lastStatus !== "WORKING" && (
        <QrBox lineId={line.id} onConnected={() => void onChanged().then(() => setShowQr(false))} />
      )}

      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}

      {canManage && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {manageable && !line.legacySession && (
            <button className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg font-medium transition-colors disabled:opacity-50 border border-slate-200 bg-white px-3 text-xs text-slate-700 hover:bg-slate-50" disabled={busy} onClick={() => void connect()}>
              {busy ? <Loader2 size={13} className="animate-spin" /> : <QrCode size={13} />}
              {line.lastStatus === "WORKING" ? "Reiniciar sesión" : "Conectar con QR"}
            </button>
          )}
          {manageable && line.legacySession && line.lastStatus !== "WORKING" && (
            <button className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg font-medium transition-colors disabled:opacity-50 border border-amber-200 bg-amber-50 px-3 text-xs text-amber-800 hover:bg-amber-100" disabled={busy} onClick={() => void connect(true)}>
              <QrCode size={13} /> Pasar a sesión propia (QR nuevo)
            </button>
          )}
          {manageable && line.lastStatus === "WORKING" && !line.isPrimary && (
            <button className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg font-medium transition-colors disabled:opacity-50 px-3 text-xs text-slate-500 hover:bg-slate-100" disabled={busy} onClick={() => void unlink()}>
              Desvincular móvil
            </button>
          )}
          <label className="ml-auto inline-flex cursor-pointer items-center gap-2 text-xs text-slate-600">
            <input type="checkbox" checked={line.active} disabled={busy} onChange={(e) => void patch({ active: e.target.checked })} />
            Activo para enviar
          </label>
          <button className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg font-medium transition-colors disabled:opacity-50 px-2 text-xs text-slate-600 hover:bg-slate-100" onClick={() => setOpen((v) => !v)}>
            Avanzado <ChevronDown size={13} className={clsx("transition-transform", open && "rotate-180")} />
          </button>
        </div>
      )}

      {open && canManage && (
        <div className="mt-3 space-y-3 border-t border-slate-100 pt-3">
          <label className="block text-xs font-medium text-slate-700">
            Nombre del número
            <input className="input mt-1" value={form.label} maxLength={60} onChange={(e) => setForm({ ...form, label: e.target.value })} />
          </label>
          <label className="block text-xs font-medium text-slate-700">
            Contexto para la IA en este número
            <textarea
              className="input mt-1 min-h-20"
              placeholder="Ej.: Línea de captación. Firmas como Aitor, comercial. Objetivo: agendar una llamada de 15 min."
              value={form.instructions}
              maxLength={4000}
              onChange={(e) => setForm({ ...form, instructions: e.target.value })}
            />
          </label>
          <div className="grid grid-cols-3 gap-2">
            <label className="block text-xs font-medium text-slate-700">
              Máx./día
              <input type="number" min={10} max={1000} className="input mt-1" value={form.dailyLimit} onChange={(e) => setForm({ ...form, dailyLimit: Number(e.target.value) })} />
            </label>
            <label className="block text-xs font-medium text-slate-700">
              Máx./hora
              <input type="number" min={5} max={200} className="input mt-1" value={form.hourlyLimit} onChange={(e) => setForm({ ...form, hourlyLimit: Number(e.target.value) })} />
            </label>
            <label className="block text-xs font-medium text-slate-700">
              Chats nuevos/día
              <input type="number" min={0} max={50} className="input mt-1" value={form.newChatsPerDay} onChange={(e) => setForm({ ...form, newChatsPerDay: Number(e.target.value) })} />
            </label>
          </div>
          <p className="text-[11px] text-slate-500">
            «Chats nuevos/día» = conversaciones que inicias tú (el cliente no ha escrito). 0 = solo responder (recomendado).
            {line.newChatsPerDay > 0 && ` Hoy el calentamiento permite ${line.newChatsCapToday} (día ${line.warmupDays} de 14).`}
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg bg-brand-500 px-3 text-xs font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-50"
              disabled={busy}
              onClick={() =>
                void patch({
                  label: form.label,
                  instructions: form.instructions,
                  dailyLimit: form.dailyLimit,
                  hourlyLimit: form.hourlyLimit,
                  newChatsPerDay: form.newChatsPerDay,
                })
              }
            >
              Guardar
            </button>
            <button className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg font-medium transition-colors disabled:opacity-50 px-3 text-xs text-slate-600 hover:bg-slate-100" disabled={busy} onClick={() => void patch({ resetWarmup: true })}>
              Reiniciar calentamiento
            </button>
            {!line.isPrimary && (line.mode === "own" || isOperator) && (
              <button className="ml-auto inline-flex h-8 items-center justify-center gap-1.5 rounded-lg px-3 text-xs font-medium text-red-600 transition-colors hover:bg-red-50 disabled:opacity-50" disabled={busy} onClick={() => void remove()}>
                <Trash2 size={13} /> Quitar de la bandeja
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function LearningTab({ canManage }: { canManage: boolean }) {
  const agentName = useAgentName();
  const [data, setData] = useState<Learning | null>(null);
  const [guide, setGuide] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const { ok, data } = await jsonFetch<Learning>("/api/v1/inbox/learning");
    if (ok) {
      setData(data);
      setGuide(data.styleGuide);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function act(method: "PUT" | "POST", body?: Record<string, unknown>) {
    setBusy(true);
    setError("");
    const res = await jsonFetch<any>("/api/v1/inbox/learning", { method, body: body ? JSON.stringify(body) : undefined });
    setBusy(false);
    if (!res.ok) setError(res.data?.error ?? "No se pudo completar");
    else {
      setData(res.data);
      setGuide(res.data.styleGuide);
    }
  }

  if (!data) return <div className="flex justify-center p-8 text-slate-400"><Loader2 className="animate-spin" /></div>;
  const s = data.stats;
  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">
        Cada vez que alguien del equipo responde (desde aquí o desde el móvil), {agentName} compara su propuesta con lo que se envió y aprende el
        estilo del negocio para las siguientes.
      </p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          { label: "Enviadas tal cual", value: s.acceptanceRate === null ? "—" : `${s.acceptanceRate}%` },
          { label: "Útiles (tal cual o retocadas)", value: s.usefulRate === null ? "—" : `${s.usefulRate}%` },
          { label: "Correcciones", value: s.edited + s.rewritten },
          { label: "Escritas por el equipo", value: s.written + s.phone },
        ].map((k) => (
          <div key={k.label} className="rounded-lg border border-slate-200 p-3">
            <div className="text-lg font-semibold">{k.value}</div>
            <div className="text-[11px] text-slate-500">{k.label}</div>
          </div>
        ))}
      </div>
      <p className="text-[11px] text-slate-400">Últimos 30 días · {s.total} respuestas analizadas.</p>

      <div>
        <div className="mb-1 flex items-center justify-between gap-2">
          <span className="text-sm font-medium">Guía de estilo aprendida</span>
          <span className="inline-flex items-center gap-1 text-[11px] text-slate-500">
            {data.locked ? <Lock size={11} /> : <LockOpen size={11} />}
            {data.locked ? "Editada a mano (no se reescribe sola)" : data.refreshedAt ? `Actualizada ${new Date(data.refreshedAt).toLocaleDateString("es-ES")}` : "Se crea con las 3 primeras respuestas del equipo"}
          </span>
        </div>
        <textarea
          className="input min-h-40 font-mono text-xs"
          value={guide}
          disabled={!canManage}
          placeholder={`Aún vacía. ${agentName} la escribirá sola cuando haya respuestas del equipo, o puedes redactarla tú (p. ej. «- Tutea siempre», «- Firma como Laura»).`}
          onChange={(e) => setGuide(e.target.value)}
        />
        {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
        {canManage && (
          <div className="mt-2 flex flex-wrap gap-2">
            <button className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg bg-brand-500 px-3 text-xs font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-50" disabled={busy || guide === data.styleGuide} onClick={() => void act("PUT", { styleGuide: guide })}>
              Guardar guía
            </button>
            <button className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg font-medium transition-colors disabled:opacity-50 border border-slate-200 px-3 text-xs text-slate-700 hover:bg-slate-50" disabled={busy} onClick={() => void act("POST")}>
              {busy ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Reaprender ahora
            </button>
            {data.locked && (
              <button className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg font-medium transition-colors disabled:opacity-50 px-3 text-xs text-slate-600 hover:bg-slate-100" disabled={busy} onClick={() => void act("PUT", { locked: false })}>
                Dejar que se actualice sola
              </button>
            )}
          </div>
        )}
      </div>

      {data.recentCorrections.length > 0 && (
        <div>
          <div className="mb-2 text-sm font-medium">Últimas correcciones a la IA</div>
          <div className="space-y-2">
            {data.recentCorrections.map((c) => (
              <div key={c.id} className="rounded-lg border border-slate-200 p-3 text-xs">
                <div className="text-slate-500">Cliente: {c.customerText}</div>
                {c.aiDraft && <div className="mt-1 text-slate-400 line-through decoration-slate-300">{c.aiDraft}</div>}
                <div className="mt-1 font-medium text-slate-800">{c.finalText}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ProtectionsList() {
  const items = [
    ["Solo responder", "Por defecto ningún número escribe a quien no le ha escrito antes (lo que más baneos provoca)."],
    ["Lectura y «escribiendo…»", "Antes de cada mensaje se marca como leído y se muestra «escribiendo…» el tiempo que tardaría una persona."],
    ["Espera a que termine", "Si el cliente manda varios mensajes seguidos, se responde una sola vez a todos."],
    ["Ritmo por número", "Separación aleatoria entre envíos y límites por hora y por día; lo que excede se programa, no se pierde."],
    ["Bajas automáticas", "«Stop», «baja» o «no me escribáis más» cortan todo envío a ese chat al instante."],
    ["Anti-envío masivo", "No deja mandar el mismo texto a muchos chats ni enlaces en un primer mensaje."],
    ["Sin bucles", "La IA no envía más de 2 mensajes seguidos sin respuesta del cliente (una persona, 5)."],
    ["Cortacircuitos", "Si un número falla varias veces o WhatsApp lo rechaza, se pausa solo y te avisa por alerta urgente."],
    ["Calentamiento", "Los números nuevos empiezan con un cupo reducido de chats nuevos que sube en 14 días."],
  ];
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {items.map(([title, text]) => (
        <div key={title} className="rounded-lg border border-slate-200 p-3">
          <div className="flex items-center gap-1.5 text-sm font-medium">
            <ShieldCheck size={14} className="text-emerald-600" /> {title}
          </div>
          <p className="mt-1 text-xs text-slate-500">{text}</p>
        </div>
      ))}
    </div>
  );
}

export default function PhonesModal({ onClose }: { onClose: () => void }) {
  const agentName = useAgentName();
  const [tab, setTab] = useState<"lines" | "learning" | "security">("lines");
  const [lines, setLines] = useState<LineDetail[] | null>(null);
  const [canManage, setCanManage] = useState(false);
  const [isOperator, setIsOperator] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [linkForm, setLinkForm] = useState({ sessionName: "", label: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const dialogRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const { ok, data } = await jsonFetch("/api/v1/inbox/lines");
    if (ok) {
      setLines(data.lines);
      setCanManage(Boolean(data.canManage));
      setIsOperator(Boolean(data.isOperator));
    } else setError(data?.error ?? "No se pudieron cargar los números");
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 15000);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    dialogRef.current?.focus();
    return () => {
      clearInterval(t);
      window.removeEventListener("keydown", onKey);
    };
  }, [load, onClose]);

  async function addLine(e: React.FormEvent) {
    e.preventDefault();
    if (!newLabel.trim()) return;
    setBusy(true);
    setError("");
    const { ok, data } = await jsonFetch("/api/v1/inbox/lines", { method: "POST", body: JSON.stringify({ label: newLabel.trim() }) });
    setBusy(false);
    if (!ok) return setError(data?.error ?? "No se pudo añadir el número");
    if (data.connectError) setError(`Número creado, pero ${data.connectError}. Pulsa «Conectar con QR» para reintentarlo.`);
    setNewLabel("");
    await load();
  }

  async function linkLine(e: React.FormEvent) {
    e.preventDefault();
    if (
      !confirm(
        `Se añadirá el webhook del CRM a la sesión «${linkForm.sessionName}». WAHA la reinicia unos segundos al cambiar su configuración (el móvil NO se desvincula). ¿Continuar?`
      )
    ) {
      return;
    }
    setBusy(true);
    setError("");
    const { ok, data } = await jsonFetch("/api/v1/inbox/lines/link", { method: "POST", body: JSON.stringify(linkForm) });
    setBusy(false);
    if (!ok) return setError(data?.error ?? "No se pudo enlazar");
    setLinkForm({ sessionName: "", label: "" });
    await load();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 sm:items-center sm:p-4" onClick={onClose}>
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Teléfonos de WhatsApp"
        className="flex max-h-[92dvh] w-full max-w-3xl flex-col overflow-hidden rounded-t-2xl bg-white shadow-xl outline-none sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <h2 className="text-base font-semibold">Teléfonos de WhatsApp</h2>
          <button onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100" aria-label="Cerrar">
            <X size={18} />
          </button>
        </div>
        <div className="flex gap-1 border-b border-slate-100 px-3 pt-2">
          {[
            { id: "lines", label: "Números", icon: Smartphone },
            { id: "learning", label: "Aprendizaje IA", icon: Brain },
            { id: "security", label: "Anti-baneo", icon: ShieldCheck },
          ].map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setTab(id as typeof tab)}
              className={clsx(
                "-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium",
                tab === id ? "border-brand-500 text-brand-700" : "border-transparent text-slate-500 hover:text-slate-800"
              )}
            >
              <Icon size={14} /> {label}
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {tab === "lines" && (
            <div className="space-y-3">
              {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
              {!lines && <div className="flex justify-center p-8 text-slate-400"><Loader2 className="animate-spin" /></div>}
              {lines?.length === 0 && (
                <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
                  El servicio de WhatsApp de este negocio aún no está aprovisionado. Contacta con Negocio Vivo para activarlo.
                </p>
              )}
              {lines?.map((line) => (
                <LineCard key={line.id} line={line} canManage={canManage} isOperator={isOperator} onChanged={load} agentName={agentName} />
              ))}

              {canManage && lines && lines.length > 0 && (
                <form onSubmit={addLine} className="flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-slate-300 p-3">
                  <Plus size={16} className="text-slate-400" />
                  <input
                    className="input min-w-0 flex-1 sm:max-w-xs"
                    placeholder="Nombre del nuevo número (p. ej. Recepción 2)"
                    value={newLabel}
                    maxLength={60}
                    onChange={(e) => setNewLabel(e.target.value)}
                  />
                  <button className="btn-primary" disabled={busy || !newLabel.trim()}>
                    {busy ? <Loader2 size={14} className="animate-spin" /> : <QrCode size={14} />} Añadir y ver QR
                  </button>
                </form>
              )}

              {isOperator && canManage && lines && lines.length > 0 && (
                <form onSubmit={linkLine} className="space-y-2 rounded-xl border border-indigo-100 bg-indigo-50/40 p-3">
                  <div className="flex items-center gap-1.5 text-sm font-medium text-indigo-900">
                    <Link2 size={14} /> Enlazar un número que ya funciona en WAHA (solo operadores NV)
                  </div>
                  <p className="text-xs text-indigo-900/70">
                    Para leer y responder aquí, por ejemplo, los números del Hub. Solo se añade el webhook del CRM a la sesión (WAHA la reinicia unos
                    segundos; el móvil no se desvincula). Solo sesiones de la lista WAHA_LINKABLE_SESSIONS. Empieza en modo «Propone» para no pisar otras
                    automatizaciones.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <input
                      className="input min-w-0 flex-1 font-mono"
                      placeholder="Nombre de la sesión WAHA"
                      value={linkForm.sessionName}
                      onChange={(e) => setLinkForm({ ...linkForm, sessionName: e.target.value })}
                    />
                    <input
                      className="input min-w-0 flex-1"
                      placeholder="Etiqueta (p. ej. Captación 3)"
                      value={linkForm.label}
                      maxLength={60}
                      onChange={(e) => setLinkForm({ ...linkForm, label: e.target.value })}
                    />
                    <button className="btn bg-indigo-600 text-white hover:bg-indigo-700" disabled={busy || !linkForm.sessionName || !linkForm.label}>
                      Enlazar
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}
          {tab === "learning" && <LearningTab canManage={canManage} />}
          {tab === "security" && <ProtectionsList />}
        </div>
      </div>
    </div>
  );
}
