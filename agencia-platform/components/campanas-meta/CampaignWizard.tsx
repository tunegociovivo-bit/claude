"use client";

import { useEffect, useState } from "react";
import {
  X,
  Loader2,
  ChevronRight,
  ChevronLeft,
  Plus,
  Trash2,
  Check,
  AlertCircle,
  Image as ImageIcon,
  Film,
  LayoutGrid,
  Sparkles,
  Upload,
  Eye
} from "lucide-react";

/**
 * Wizard de creación de campaña Meta. 6 pasos:
 *   1. Identidad        — nombre, descripción, fanpage, URL admin
 *   2. Programación     — fechas, presupuesto diario
 *   3. Objetivo         — tipo (LEADS/TRAFFIC/…), destino (si LEADS),
 *                          aceptación de políticas Meta
 *   4. Audiencia        — modo conjuntos (frío / frío+remk / custom),
 *                          segmentación libre, ubicaciones inc/exc
 *   5. Anuncios         — nº de IMAGE/CAROUSEL/VIDEO por conjunto,
 *                          modo visual (user sube / IA genera),
 *                          preview placeholder por anuncio
 *   6. Leads y revisión — emails que reciben los leads, fecha review,
 *                          (si LEADS+INSTANT_FORM) preguntas formulario
 *
 * Al "Crear campaña" → POST /api/v1/meta/campaigns con todo el payload.
 * El backend persiste todo, crea la Task asociada y devuelve la
 * campaña con sus relaciones.
 *
 * Fase 1: las preguntas de formulario, copys y visuales se introducen
 * a mano. Fase 2 las generará la IA (botón "Proponer con IA"
 * placeholder ya está pintado para que el sitio no cambie luego).
 */

type Objective = "LEADS" | "TRAFFIC" | "ENGAGEMENT" | "CONVERSIONS" | "AWARENESS" | "SALES" | "APP_PROMOTION" | "VIDEO_VIEWS" | "REACH";
type LeadDestination = "INSTANT_FORM" | "WEBSITE" | "MESSENGER" | "WHATSAPP" | "PHONE_CALL";
type AdsetMode = "COLD_ONLY" | "COLD_PLUS_REMARKETING" | "CUSTOM";
type VisualMode = "USER_UPLOADS" | "AI_GENERATES";

const OBJECTIVES: { value: Objective; label: string }[] = [
  { value: "LEADS", label: "Clientes potenciales" },
  { value: "TRAFFIC", label: "Tráfico" },
  { value: "ENGAGEMENT", label: "Interacción" },
  { value: "CONVERSIONS", label: "Conversiones" },
  { value: "SALES", label: "Ventas" },
  { value: "AWARENESS", label: "Reconocimiento" },
  { value: "VIDEO_VIEWS", label: "Reproducciones de vídeo" },
  { value: "REACH", label: "Alcance" },
  { value: "APP_PROMOTION", label: "Promoción de app" }
];

const LEAD_DESTINATIONS: { value: LeadDestination; label: string; hint: string }[] = [
  { value: "INSTANT_FORM", label: "Formularios instantáneos", hint: "Formulario nativo de Meta (la IA propone las preguntas)" },
  { value: "WEBSITE", label: "Sitio web", hint: "El lead rellena un formulario en tu landing" },
  { value: "MESSENGER", label: "Messenger", hint: "Conversación dirigida en Messenger" },
  { value: "WHATSAPP", label: "WhatsApp", hint: "Inicia conversación en WhatsApp Business" },
  { value: "PHONE_CALL", label: "Llamada", hint: "Botón de llamar directo" }
];

type AdsetDescriptor = {
  label: string;
  audienceBrief: string;
  adsByFormat: { IMAGE: number; CAROUSEL: number; VIDEO: number };
};

type FormQuestion = {
  question: string;
  type: "TEXT" | "EMAIL" | "PHONE" | "NUMBER" | "CHOICE";
  required: boolean;
  options?: string[];
};

const TODAY = new Date().toISOString().slice(0, 10);

const PRESET_FORM_QUESTIONS: FormQuestion[] = [
  { question: "Nombre y apellidos", type: "TEXT", required: true },
  { question: "Email", type: "EMAIL", required: true },
  { question: "Teléfono", type: "PHONE", required: true }
];

export default function CampaignWizard({
  open,
  onClose,
  onCreated
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [step, setStep] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // --- Paso 1: identidad ---
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [fanpageName, setFanpageName] = useState("");
  const [fanpageUrl, setFanpageUrl] = useState("");
  const [adsManagerUrl, setAdsManagerUrl] = useState("");
  const [clientId, setClientId] = useState<string>("");
  const [ownerId, setOwnerId] = useState<string>("");
  const [clients, setClients] = useState<{ id: string; name: string }[]>([]);
  const [members, setMembers] = useState<{ id: string; name: string | null; email: string }[]>([]);

  // --- Paso 2: programación + presupuesto ---
  const [startDate, setStartDate] = useState(TODAY);
  const [endDate, setEndDate] = useState("");
  const [noEndDate, setNoEndDate] = useState(true);
  const [dailyBudget, setDailyBudget] = useState<number>(20);

  // --- Paso 3: objetivo + destino + políticas ---
  const [objective, setObjective] = useState<Objective>("LEADS");
  const [leadDestination, setLeadDestination] = useState<LeadDestination>("INSTANT_FORM");
  const [policiesAccepted, setPoliciesAccepted] = useState(false);

  // --- Paso 4: audiencia ---
  const [adsetMode, setAdsetMode] = useState<AdsetMode>("COLD_PLUS_REMARKETING");
  const [adsets, setAdsets] = useState<AdsetDescriptor[]>([
    { label: "Público frío", audienceBrief: "", adsByFormat: { IMAGE: 2, CAROUSEL: 0, VIDEO: 0 } },
    { label: "Remarketing 30d", audienceBrief: "", adsByFormat: { IMAGE: 1, CAROUSEL: 1, VIDEO: 0 } }
  ]);
  const [segmentationRaw, setSegmentationRaw] = useState("");
  const [locInc, setLocInc] = useState("");
  const [locExc, setLocExc] = useState("");

  // --- Paso 5: anuncios ---
  const [visualMode, setVisualMode] = useState<VisualMode>("AI_GENERATES");

  // --- Paso 6: leads + revisión ---
  const [leadEmailsText, setLeadEmailsText] = useState("");
  const [reviewDate, setReviewDate] = useState("");
  const [formQuestions, setFormQuestions] = useState<FormQuestion[]>(PRESET_FORM_QUESTIONS);

  // Reset al abrir
  useEffect(() => {
    if (!open) return;
    setStep(1);
    setError(null);
    // Carga catálogos
    Promise.all([
      fetch("/api/v1/clients?limit=200").then((r) => r.json()).catch(() => ({})),
      fetch("/api/v1/team").then((r) => r.json()).catch(() => ({}))
    ]).then(([cli, team]) => {
      setClients(cli.items ?? cli.clients ?? []);
      setMembers(team.items ?? team.members ?? []);
    });
  }, [open]);

  // Sincroniza el array de adsets cuando el user cambia el modo.
  useEffect(() => {
    if (adsetMode === "COLD_ONLY") {
      setAdsets([{ label: "Público frío", audienceBrief: "", adsByFormat: { IMAGE: 2, CAROUSEL: 0, VIDEO: 0 } }]);
    } else if (adsetMode === "COLD_PLUS_REMARKETING") {
      setAdsets([
        { label: "Público frío", audienceBrief: "", adsByFormat: { IMAGE: 2, CAROUSEL: 0, VIDEO: 0 } },
        { label: "Remarketing 30d", audienceBrief: "", adsByFormat: { IMAGE: 1, CAROUSEL: 1, VIDEO: 0 } }
      ]);
    }
    // CUSTOM: no tocamos, el user define
  }, [adsetMode]);

  if (!open) return null;

  // -------- Validaciones por paso ---------
  function validateStep(): string | null {
    if (step === 1) {
      if (!name.trim()) return "Pon un nombre a la campaña";
    }
    if (step === 2) {
      if (!startDate) return "Fecha de inicio obligatoria";
      if (!noEndDate && !endDate) return "Pon fecha final o marca 'sin fecha de finalización'";
      if (!noEndDate && endDate && endDate < startDate) return "La fecha final no puede ser anterior al inicio";
      if (!dailyBudget || dailyBudget <= 0) return "Inversión diaria debe ser > 0";
    }
    if (step === 3) {
      if (!policiesAccepted) return "Tienes que aceptar las políticas de Meta";
    }
    if (step === 4) {
      if (adsets.length === 0) return "Necesitas al menos un conjunto de anuncios";
      if (adsets.some((a) => !a.label.trim())) return "Pon un nombre a cada conjunto";
      if (!segmentationRaw.trim()) return "Describe la segmentación / público objetivo";
    }
    if (step === 5) {
      const totalAds = adsets.reduce(
        (acc, a) => acc + a.adsByFormat.IMAGE + a.adsByFormat.CAROUSEL + a.adsByFormat.VIDEO,
        0
      );
      if (totalAds === 0) return "Tienes que crear al menos 1 anuncio en algún conjunto";
    }
    if (step === 6) {
      if (objective === "LEADS" && leadDestination === "INSTANT_FORM" && formQuestions.length === 0) {
        return "El formulario debe tener al menos 1 pregunta";
      }
    }
    return null;
  }

  function next() {
    const err = validateStep();
    if (err) {
      setError(err);
      return;
    }
    setError(null);
    setStep((s) => s + 1);
  }
  function prev() {
    setError(null);
    setStep((s) => s - 1);
  }

  async function submit() {
    const err = validateStep();
    if (err) {
      setError(err);
      return;
    }
    setSubmitting(true);
    setError(null);

    const leadEmails = leadEmailsText
      .split(/[,\n;]/)
      .map((s) => s.trim())
      .filter((s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s));

    const payload = {
      name: name.trim(),
      description: description.trim() || null,
      clientId: clientId || null,
      ownerId: ownerId || null,
      adsManagerUrl: adsManagerUrl.trim() || null,
      fanpageUrl: fanpageUrl.trim() || null,
      fanpageName: fanpageName.trim() || null,
      startDate: new Date(startDate + "T09:00:00").toISOString(),
      endDate: noEndDate || !endDate ? null : new Date(endDate + "T22:00:00").toISOString(),
      dailyBudgetEuros: Number(dailyBudget),
      objective,
      leadDestination: objective === "LEADS" ? leadDestination : null,
      metaPoliciesAccepted: true,
      adsetMode,
      adsets,
      segmentationRaw: segmentationRaw.trim(),
      locationsIncluded: locInc.split(",").map((s) => s.trim()).filter(Boolean),
      locationsExcluded: locExc.split(",").map((s) => s.trim()).filter(Boolean),
      visualMode,
      formQuestions:
        objective === "LEADS" && leadDestination === "INSTANT_FORM" ? formQuestions : undefined,
      leadEmails,
      reviewAt: reviewDate ? new Date(reviewDate + "T09:00:00").toISOString() : null
    };

    try {
      const r = await fetch("/api/v1/meta/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error?.message ?? `Error ${r.status}`);
      onCreated();
    } catch (e: any) {
      setError(e?.message ?? "No se pudo crear la campaña");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[85] bg-slate-900/50 backdrop-blur-sm grid place-items-stretch sm:place-items-center p-0 sm:p-4">
      <div className="bg-white w-full max-w-3xl h-full sm:h-auto sm:max-h-[92vh] sm:rounded-xl shadow-2xl border flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-5 py-3 border-b flex items-center gap-2 shrink-0">
          <Sparkles className="h-4 w-4 text-brand-600" />
          <h3 className="font-semibold text-slate-900 flex-1">Nueva campaña Meta — paso {step}/6</h3>
          {!submitting && (
            <button onClick={onClose} className="p-1 hover:bg-slate-100 rounded">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Stepper visual */}
        <div className="px-5 py-3 border-b bg-slate-50 shrink-0">
          <div className="flex items-center gap-2 text-xs overflow-x-auto">
            {[
              "Identidad",
              "Programación",
              "Objetivo",
              "Audiencia",
              "Anuncios",
              "Leads y revisión"
            ].map((label, i) => {
              const n = i + 1;
              const active = step === n;
              const done = step > n;
              return (
                <div
                  key={n}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full whitespace-nowrap ${
                    active
                      ? "bg-brand-600 text-white font-medium"
                      : done
                        ? "bg-emerald-100 text-emerald-700"
                        : "bg-white text-slate-500 border border-slate-200"
                  }`}
                >
                  {done ? (
                    <Check className="h-3 w-3" />
                  ) : (
                    <span className="h-4 w-4 grid place-items-center text-[10px] font-bold">
                      {n}
                    </span>
                  )}
                  {label}
                </div>
              );
            })}
          </div>
        </div>

        {/* Cuerpo scrollable */}
        <div className="flex-1 overflow-y-auto px-5 py-5 space-y-4">
          {step === 1 && (
            <Step1Identity
              name={name} setName={setName}
              description={description} setDescription={setDescription}
              fanpageName={fanpageName} setFanpageName={setFanpageName}
              fanpageUrl={fanpageUrl} setFanpageUrl={setFanpageUrl}
              adsManagerUrl={adsManagerUrl} setAdsManagerUrl={setAdsManagerUrl}
              clientId={clientId} setClientId={setClientId}
              ownerId={ownerId} setOwnerId={setOwnerId}
              clients={clients} members={members}
            />
          )}
          {step === 2 && (
            <Step2Schedule
              startDate={startDate} setStartDate={setStartDate}
              endDate={endDate} setEndDate={setEndDate}
              noEndDate={noEndDate} setNoEndDate={setNoEndDate}
              dailyBudget={dailyBudget} setDailyBudget={setDailyBudget}
            />
          )}
          {step === 3 && (
            <Step3Objective
              objective={objective} setObjective={setObjective}
              leadDestination={leadDestination} setLeadDestination={setLeadDestination}
              policiesAccepted={policiesAccepted} setPoliciesAccepted={setPoliciesAccepted}
            />
          )}
          {step === 4 && (
            <Step4Audience
              adsetMode={adsetMode} setAdsetMode={setAdsetMode}
              adsets={adsets} setAdsets={setAdsets}
              segmentationRaw={segmentationRaw} setSegmentationRaw={setSegmentationRaw}
              locInc={locInc} setLocInc={setLocInc}
              locExc={locExc} setLocExc={setLocExc}
            />
          )}
          {step === 5 && (
            <Step5Ads
              adsets={adsets} setAdsets={setAdsets}
              visualMode={visualMode} setVisualMode={setVisualMode}
            />
          )}
          {step === 6 && (
            <Step6Leads
              objective={objective}
              leadDestination={leadDestination}
              leadEmailsText={leadEmailsText} setLeadEmailsText={setLeadEmailsText}
              reviewDate={reviewDate} setReviewDate={setReviewDate}
              formQuestions={formQuestions} setFormQuestions={setFormQuestions}
            />
          )}

          {error && (
            <div className="rounded-lg bg-rose-50 border border-rose-200 px-3 py-2 text-sm text-rose-700 flex items-start gap-2">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </div>

        {/* Footer con navegación */}
        <div className="px-5 py-3 border-t flex items-center justify-between gap-2 bg-slate-50 shrink-0">
          <button
            onClick={prev}
            disabled={step === 1 || submitting}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <ChevronLeft className="h-4 w-4" />
            Atrás
          </button>
          {step < 6 ? (
            <button
              onClick={next}
              disabled={submitting}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium"
            >
              Continuar
              <ChevronRight className="h-4 w-4" />
            </button>
          ) : (
            <button
              onClick={submit}
              disabled={submitting}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium disabled:opacity-50"
            >
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
              <Sparkles className="h-4 w-4" />
              Crear campaña + tarea
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Steps
// ─────────────────────────────────────────────────────────────────────

function Step1Identity(props: any) {
  return (
    <>
      <SectionTitle title="Identidad" subtitle="Datos básicos para identificar la campaña en el Hub y en Meta." />
      <Field label="Nombre de la campaña *">
        <input
          type="text"
          value={props.name}
          onChange={(e) => props.setName(e.target.value)}
          placeholder="p.ej. Captación leads — Madrid Q2"
          className="w-full px-3 py-2 rounded-lg border focus:ring-2 focus:ring-brand-200 focus:border-brand-400"
        />
      </Field>
      <Field
        label="Descripción / briefing"
        hint="Texto libre para explicar el contexto, el público objetivo y qué buscas con esta campaña. La IA lo usará en Fase 2 para generar segmentación y copys."
      >
        <textarea
          value={props.description}
          onChange={(e) => props.setDescription(e.target.value)}
          rows={3}
          placeholder="Buscamos captar leads de propietarios de coches Audi/BMW/Mercedes en Málaga interesados en mantenimiento premium…"
          className="w-full px-3 py-2 rounded-lg border focus:ring-2 focus:ring-brand-200 focus:border-brand-400"
        />
      </Field>
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="Fanpage (nombre)">
          <input
            type="text"
            value={props.fanpageName}
            onChange={(e) => props.setFanpageName(e.target.value)}
            placeholder="Mi Marca SL"
            className="w-full px-3 py-2 rounded-lg border focus:ring-2 focus:ring-brand-200 focus:border-brand-400"
          />
        </Field>
        <Field label="Fanpage (URL)">
          <input
            type="url"
            value={props.fanpageUrl}
            onChange={(e) => props.setFanpageUrl(e.target.value)}
            placeholder="https://www.facebook.com/mi-marca"
            className="w-full px-3 py-2 rounded-lg border focus:ring-2 focus:ring-brand-200 focus:border-brand-400"
          />
        </Field>
      </div>
      <Field label="URL Administrador de anuncios">
        <input
          type="url"
          value={props.adsManagerUrl}
          onChange={(e) => props.setAdsManagerUrl(e.target.value)}
          placeholder="https://business.facebook.com/adsmanager/manage/campaigns?act=…"
          className="w-full px-3 py-2 rounded-lg border focus:ring-2 focus:ring-brand-200 focus:border-brand-400"
        />
      </Field>
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="Cliente del CRM (opcional)">
          <select
            value={props.clientId}
            onChange={(e) => props.setClientId(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border bg-white focus:ring-2 focus:ring-brand-200 focus:border-brand-400"
          >
            <option value="">— Ninguno —</option>
            {props.clients.map((c: any) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </Field>
        <Field label="Responsable de la campaña">
          <select
            value={props.ownerId}
            onChange={(e) => props.setOwnerId(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border bg-white focus:ring-2 focus:ring-brand-200 focus:border-brand-400"
          >
            <option value="">— Tú mismo —</option>
            {props.members.map((m: any) => (
              <option key={m.id} value={m.id}>{m.name ?? m.email}</option>
            ))}
          </select>
        </Field>
      </div>
    </>
  );
}

function Step2Schedule(props: any) {
  return (
    <>
      <SectionTitle title="Programación y presupuesto" />
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="Fecha de inicio *">
          <input
            type="date"
            value={props.startDate}
            onChange={(e) => props.setStartDate(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border focus:ring-2 focus:ring-brand-200 focus:border-brand-400"
          />
        </Field>
        <Field label="Fecha final">
          <div className="flex flex-col gap-1.5">
            <input
              type="date"
              value={props.endDate}
              onChange={(e) => props.setEndDate(e.target.value)}
              disabled={props.noEndDate}
              className="w-full px-3 py-2 rounded-lg border focus:ring-2 focus:ring-brand-200 focus:border-brand-400 disabled:bg-slate-50 disabled:text-slate-400"
            />
            <label className="inline-flex items-center gap-2 text-xs text-slate-600">
              <input
                type="checkbox"
                checked={props.noEndDate}
                onChange={(e) => props.setNoEndDate(e.target.checked)}
              />
              Sin fecha de finalización (campaña abierta)
            </label>
          </div>
        </Field>
      </div>
      <Field label="Inversión diaria (€)" hint="Cuánto se gasta cada día como máximo (se aplica a nivel de campaña o conjunto según objetivo).">
        <div className="relative">
          <input
            type="number"
            min={1}
            step={0.5}
            value={props.dailyBudget}
            onChange={(e) => props.setDailyBudget(Number(e.target.value))}
            className="w-full px-3 py-2 pr-8 rounded-lg border focus:ring-2 focus:ring-brand-200 focus:border-brand-400"
          />
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">€</span>
        </div>
      </Field>
    </>
  );
}

function Step3Objective(props: any) {
  return (
    <>
      <SectionTitle title="Objetivo de la campaña" />
      <Field label="Tipo de campaña *">
        <div className="grid sm:grid-cols-2 gap-2">
          {OBJECTIVES.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => props.setObjective(o.value)}
              className={`text-left px-3 py-2 rounded-lg border text-sm ${
                props.objective === o.value
                  ? "bg-brand-50 border-brand-400 text-brand-900"
                  : "bg-white border-slate-200 hover:bg-slate-50"
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
      </Field>

      {props.objective === "LEADS" && (
        <Field label="Destino de clientes potenciales *">
          <div className="space-y-2">
            {LEAD_DESTINATIONS.map((d) => (
              <label
                key={d.value}
                className={`flex items-start gap-2 px-3 py-2 rounded-lg border cursor-pointer ${
                  props.leadDestination === d.value
                    ? "bg-brand-50 border-brand-400"
                    : "bg-white border-slate-200 hover:bg-slate-50"
                }`}
              >
                <input
                  type="radio"
                  className="mt-0.5"
                  checked={props.leadDestination === d.value}
                  onChange={() => props.setLeadDestination(d.value)}
                />
                <div>
                  <div className="text-sm font-medium text-slate-900">{d.label}</div>
                  <div className="text-xs text-slate-500">{d.hint}</div>
                </div>
              </label>
            ))}
          </div>
        </Field>
      )}

      <div className="rounded-lg bg-amber-50 border border-amber-200 p-3">
        <label className="flex items-start gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={props.policiesAccepted}
            onChange={(e) => props.setPoliciesAccepted(e.target.checked)}
            className="mt-0.5"
          />
          <div className="text-sm text-amber-900">
            Confirmo que esta campaña cumple las{" "}
            <a
              href="https://transparency.meta.com/policies/ad-standards"
              target="_blank"
              rel="noreferrer"
              className="underline"
            >políticas publicitarias de Meta</a>
            {" "}(no contiene contenido prohibido, cumple GDPR, no usa segmentación restringida, etc.).
          </div>
        </label>
      </div>
    </>
  );
}

function Step4Audience(props: any) {
  const ADSET_MODES: { value: AdsetMode; label: string; hint: string }[] = [
    { value: "COLD_ONLY", label: "Solo público frío", hint: "1 conjunto. Buscas captar gente nueva." },
    { value: "COLD_PLUS_REMARKETING", label: "Frío + Remarketing", hint: "2 conjuntos. Captas nuevos y recuperas visitas pasadas." },
    { value: "CUSTOM", label: "Personalizado", hint: "Tú defines cuántos conjuntos y a quién va cada uno." }
  ];

  function addAdset() {
    props.setAdsets([
      ...props.adsets,
      { label: `Conjunto ${props.adsets.length + 1}`, audienceBrief: "", adsByFormat: { IMAGE: 1, CAROUSEL: 0, VIDEO: 0 } }
    ]);
  }
  function removeAdset(i: number) {
    props.setAdsets(props.adsets.filter((_: any, idx: number) => idx !== i));
  }
  function updateAdset(i: number, patch: Partial<AdsetDescriptor>) {
    props.setAdsets(props.adsets.map((a: AdsetDescriptor, idx: number) => idx === i ? { ...a, ...patch } : a));
  }

  return (
    <>
      <SectionTitle title="Audiencia" subtitle="¿Cuántos conjuntos quieres y a quién apunta cada uno?" />

      <Field label="Modo de conjuntos *">
        <div className="space-y-2">
          {ADSET_MODES.map((m) => (
            <label
              key={m.value}
              className={`flex items-start gap-2 px-3 py-2 rounded-lg border cursor-pointer ${
                props.adsetMode === m.value
                  ? "bg-brand-50 border-brand-400"
                  : "bg-white border-slate-200 hover:bg-slate-50"
              }`}
            >
              <input
                type="radio"
                className="mt-0.5"
                checked={props.adsetMode === m.value}
                onChange={() => props.setAdsetMode(m.value)}
              />
              <div>
                <div className="text-sm font-medium text-slate-900">{m.label}</div>
                <div className="text-xs text-slate-500">{m.hint}</div>
              </div>
            </label>
          ))}
        </div>
      </Field>

      {props.adsetMode === "CUSTOM" && (
        <Field label="Conjuntos personalizados">
          <div className="space-y-2">
            {props.adsets.map((a: AdsetDescriptor, i: number) => (
              <div key={i} className="p-3 rounded-lg border bg-slate-50 space-y-2">
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={a.label}
                    onChange={(e) => updateAdset(i, { label: e.target.value })}
                    placeholder="Nombre del conjunto"
                    className="flex-1 px-2 py-1.5 rounded border text-sm bg-white"
                  />
                  <button
                    onClick={() => removeAdset(i)}
                    disabled={props.adsets.length <= 1}
                    className="p-1.5 text-rose-600 hover:bg-rose-50 rounded disabled:opacity-30"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
                <textarea
                  value={a.audienceBrief}
                  onChange={(e) => updateAdset(i, { audienceBrief: e.target.value })}
                  rows={2}
                  placeholder="A quién va dirigido este conjunto: edades, intereses, comportamientos…"
                  className="w-full px-2 py-1.5 rounded border text-sm bg-white"
                />
              </div>
            ))}
            <button
              type="button"
              onClick={addAdset}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-sm text-brand-700 hover:bg-brand-50"
            >
              <Plus className="h-3.5 w-3.5" />
              Añadir conjunto
            </button>
          </div>
        </Field>
      )}

      <Field
        label="Segmentación *"
        hint='Describe en lenguaje natural a qué público va dirigida la campaña. Cuando pulses "Generar con IA" en la ficha, la IA lo expandirá en intereses, edades y comportamientos listos para Meta API.'
      >
        <textarea
          value={props.segmentationRaw}
          onChange={(e) => props.setSegmentationRaw(e.target.value)}
          rows={4}
          placeholder="Propietarios de mascotas en Madrid de 30-55 años, ingresos medios-altos, interés en bienestar animal, dueños de razas medianas y grandes…"
          className="w-full px-3 py-2 rounded-lg border focus:ring-2 focus:ring-brand-200 focus:border-brand-400"
        />
      </Field>

      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="Ubicaciones incluidas" hint="Separadas por comas: Madrid, Barcelona, ES">
          <input
            type="text"
            value={props.locInc}
            onChange={(e) => props.setLocInc(e.target.value)}
            placeholder="Madrid, Barcelona"
            className="w-full px-3 py-2 rounded-lg border focus:ring-2 focus:ring-brand-200 focus:border-brand-400"
          />
        </Field>
        <Field label="Ubicaciones excluidas">
          <input
            type="text"
            value={props.locExc}
            onChange={(e) => props.setLocExc(e.target.value)}
            placeholder="Ceuta, Melilla"
            className="w-full px-3 py-2 rounded-lg border focus:ring-2 focus:ring-brand-200 focus:border-brand-400"
          />
        </Field>
      </div>
    </>
  );
}

function Step5Ads(props: any) {
  function updateCount(adsetIdx: number, fmt: "IMAGE" | "CAROUSEL" | "VIDEO", n: number) {
    const next = props.adsets.map((a: AdsetDescriptor, i: number) => {
      if (i !== adsetIdx) return a;
      return { ...a, adsByFormat: { ...a.adsByFormat, [fmt]: Math.max(0, n) } };
    });
    props.setAdsets(next);
  }

  return (
    <>
      <SectionTitle title="Anuncios" subtitle="Cuántos anuncios crear de cada formato en cada conjunto. Los vídeos se suben siempre a mano; imágenes/carruseles los puede generar la IA o los subes tú." />

      <Field label="Origen del contenido visual">
        <div className="grid sm:grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => props.setVisualMode("AI_GENERATES")}
            className={`text-left px-3 py-2.5 rounded-lg border ${
              props.visualMode === "AI_GENERATES" ? "bg-brand-50 border-brand-400" : "bg-white border-slate-200 hover:bg-slate-50"
            }`}
          >
            <div className="flex items-center gap-2 mb-0.5">
              <Sparkles className="h-4 w-4 text-brand-600" />
              <div className="text-sm font-medium">La plataforma genera</div>
            </div>
            <div className="text-xs text-slate-500">La IA escribe el copy y genera imágenes/carruseles. Vídeos los subes tú.</div>
          </button>
          <button
            type="button"
            onClick={() => props.setVisualMode("USER_UPLOADS")}
            className={`text-left px-3 py-2.5 rounded-lg border ${
              props.visualMode === "USER_UPLOADS" ? "bg-brand-50 border-brand-400" : "bg-white border-slate-200 hover:bg-slate-50"
            }`}
          >
            <div className="flex items-center gap-2 mb-0.5">
              <Upload className="h-4 w-4 text-slate-600" />
              <div className="text-sm font-medium">Yo subo todo</div>
            </div>
            <div className="text-xs text-slate-500">Subes tu propio material para cada anuncio.</div>
          </button>
        </div>
      </Field>

      <Field label="Anuncios por conjunto">
        <div className="space-y-3">
          {props.adsets.map((a: AdsetDescriptor, i: number) => {
            const total = a.adsByFormat.IMAGE + a.adsByFormat.CAROUSEL + a.adsByFormat.VIDEO;
            return (
              <div key={i} className="rounded-lg border bg-slate-50 p-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-sm font-medium text-slate-900">{a.label}</div>
                  <div className="text-xs text-slate-500">{total} anuncio{total === 1 ? "" : "s"} total</div>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <FormatCounter
                    icon={<ImageIcon className="h-3.5 w-3.5" />}
                    label="Imagen"
                    n={a.adsByFormat.IMAGE}
                    onChange={(n) => updateCount(i, "IMAGE", n)}
                  />
                  <FormatCounter
                    icon={<LayoutGrid className="h-3.5 w-3.5" />}
                    label="Carrusel"
                    n={a.adsByFormat.CAROUSEL}
                    onChange={(n) => updateCount(i, "CAROUSEL", n)}
                  />
                  <FormatCounter
                    icon={<Film className="h-3.5 w-3.5" />}
                    label="Vídeo"
                    n={a.adsByFormat.VIDEO}
                    onChange={(n) => updateCount(i, "VIDEO", n)}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </Field>

      <div className="rounded-lg bg-slate-100 border border-slate-200 p-3 text-xs text-slate-600 flex items-start gap-2">
        <Eye className="h-4 w-4 mt-0.5 shrink-0" />
        <div>
          <strong>Vista previa de cada anuncio</strong> con copy + visual aparecerá en la página
          de la campaña tras crearla. Cuando le des a <strong>"Generar con IA"</strong> en la
          ficha de la campaña, la plataforma escribirá el copy y generará las imágenes; tú
          revisas y apruebas antes de lanzar a Meta.
        </div>
      </div>
    </>
  );
}

function FormatCounter({ icon, label, n, onChange }: { icon: React.ReactNode; label: string; n: number; onChange: (n: number) => void }) {
  return (
    <div className="bg-white rounded border p-2 text-center">
      <div className="text-xs text-slate-500 flex items-center justify-center gap-1 mb-1">
        {icon}
        {label}
      </div>
      <div className="flex items-center justify-center gap-1">
        <button onClick={() => onChange(n - 1)} disabled={n === 0} className="h-6 w-6 grid place-items-center rounded bg-slate-100 hover:bg-slate-200 text-slate-700 disabled:opacity-30">−</button>
        <span className="font-semibold text-slate-900 w-6 text-center">{n}</span>
        <button onClick={() => onChange(n + 1)} className="h-6 w-6 grid place-items-center rounded bg-slate-100 hover:bg-slate-200 text-slate-700">+</button>
      </div>
    </div>
  );
}

function Step6Leads(props: any) {
  const isLeadInstantForm = props.objective === "LEADS" && props.leadDestination === "INSTANT_FORM";

  function updateQ(i: number, patch: Partial<FormQuestion>) {
    props.setFormQuestions(props.formQuestions.map((q: FormQuestion, idx: number) => idx === i ? { ...q, ...patch } : q));
  }
  function removeQ(i: number) {
    props.setFormQuestions(props.formQuestions.filter((_: any, idx: number) => idx !== i));
  }
  function addQ() {
    props.setFormQuestions([...props.formQuestions, { question: "", type: "TEXT", required: true }]);
  }

  return (
    <>
      <SectionTitle title="Leads y revisión automática" />

      <Field
        label="Emails para recibir leads"
        hint="Direcciones que recibirán los leads cuando se rellenen los formularios. Una por línea o separadas por comas."
      >
        <textarea
          value={props.leadEmailsText}
          onChange={(e) => props.setLeadEmailsText(e.target.value)}
          rows={2}
          placeholder="leads@miempresa.com&#10;ventas@miempresa.com"
          className="w-full px-3 py-2 rounded-lg border font-mono text-xs focus:ring-2 focus:ring-brand-200 focus:border-brand-400"
        />
      </Field>

      {isLeadInstantForm && (
        <Field
          label="Preguntas del formulario instantáneo"
          hint='Ajústalas a tu gusto. La IA puede proponer un set óptimo según tu briefing cuando pulses "Generar con IA" en la ficha (próximamente).'
        >
          <div className="space-y-2">
            {props.formQuestions.map((q: FormQuestion, i: number) => (
              <div key={i} className="p-2 rounded border bg-slate-50 grid grid-cols-[1fr,auto,auto,auto] gap-2 items-center">
                <input
                  type="text"
                  value={q.question}
                  onChange={(e) => updateQ(i, { question: e.target.value })}
                  placeholder="Pregunta"
                  className="px-2 py-1.5 rounded border text-sm bg-white"
                />
                <select
                  value={q.type}
                  onChange={(e) => updateQ(i, { type: e.target.value as any })}
                  className="px-2 py-1.5 rounded border text-xs bg-white"
                >
                  <option value="TEXT">Texto</option>
                  <option value="EMAIL">Email</option>
                  <option value="PHONE">Teléfono</option>
                  <option value="NUMBER">Número</option>
                  <option value="CHOICE">Opciones</option>
                </select>
                <label className="text-xs text-slate-600 inline-flex items-center gap-1">
                  <input type="checkbox" checked={q.required} onChange={(e) => updateQ(i, { required: e.target.checked })} />
                  Obligatorio
                </label>
                <button onClick={() => removeQ(i)} className="p-1.5 text-rose-600 hover:bg-rose-50 rounded">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
            <button
              onClick={addQ}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-sm text-brand-700 hover:bg-brand-50"
            >
              <Plus className="h-3.5 w-3.5" />
              Añadir pregunta
            </button>
          </div>
        </Field>
      )}

      <Field
        label="Fecha de revisión automática (opcional)"
        hint="La plataforma evaluará la campaña en esta fecha y te mandará un informe con recomendaciones (Fase 3)."
      >
        <input
          type="date"
          value={props.reviewDate}
          min={TODAY}
          onChange={(e) => props.setReviewDate(e.target.value)}
          className="px-3 py-2 rounded-lg border focus:ring-2 focus:ring-brand-200 focus:border-brand-400"
        />
      </Field>

      <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-3 text-xs text-emerald-900 flex items-start gap-2">
        <Check className="h-4 w-4 mt-0.5 shrink-0" />
        <div>
          Al crear la campaña, se generará automáticamente una <strong>tarea en /tareas</strong> con
          todo el detalle, asignada al responsable, con enlace al admin de Meta y a la propia
          campaña dentro del Hub.
        </div>
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────
// helpers
// ─────────────────────────────────────────────────────────────────────

function SectionTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="border-b pb-2 mb-3">
      <h4 className="text-base font-semibold text-slate-900">{title}</h4>
      {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs font-medium text-slate-700 block mb-1">{label}</label>
      {hint && <p className="text-[11px] text-slate-500 mb-1.5">{hint}</p>}
      {children}
    </div>
  );
}
