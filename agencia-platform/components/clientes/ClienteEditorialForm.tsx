"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, Plus, Trash2, Upload, X, ExternalLink } from "lucide-react";
import {
  FORMAT_PRESETS,
  EDITORIAL_FORMATS,
  REFERENCE_IMAGE_TYPES,
  SUBFOLDER_TYPES,
  LOGO_POSITIONS,
  VISUAL_PATTERNS,
  FIDELITY_BANDS,
  DRIVE_MODES,
  FONT_WEIGHTS,
  defaultDimensionsByFormat,
  type DimensionsByFormat,
  type ReferenceImage,
  type FontEntry,
  type PatternTemplate,
  type DriveSubfolder,
  type SubfolderType,
  type ReferenceImageType
} from "@/lib/editorial/client-meta";

type Meta = {
  id: string;
  name: string;
  brandBrief: string | null;
  website: string | null;
  brandColorPrimary: string;
  brandColorAccent: string;
  brandColorText: string;
  logoUrl: string | null;
  logoPosition: string;
  visualPattern: string;
  refsFidelity: number;
  competitors: string | null;
  dimensionsByFormat: DimensionsByFormat | null;
  referenceImages: ReferenceImage[] | null;
  patternTemplates: PatternTemplate[] | null;
  fonts: FontEntry[] | null;
  styleGuideCached: string | null;
  styleGuideHash: string | null;
  driveMode: string;
  driveRootId: string | null;
  driveSubfolders: DriveSubfolder[] | null;
  imageModel: string | null;
};

export default function ClienteEditorialForm({ initial }: { initial: Meta }) {
  const [form, setForm] = useState<Meta>({
    ...initial,
    dimensionsByFormat: initial.dimensionsByFormat ?? defaultDimensionsByFormat(),
    referenceImages: initial.referenceImages ?? [],
    patternTemplates: initial.patternTemplates ?? [],
    fonts: initial.fonts ?? [],
    driveSubfolders: initial.driveSubfolders ?? []
  });
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);

  function patch<K extends keyof Meta>(key: K, value: Meta[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const body = { ...form };
      // Sólo enviar campos editables
      delete (body as any).id;
      delete (body as any).name;
      const r = await fetch(`/api/v1/clients/${form.id}/editorial-meta`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j?.error?.message ?? `Error ${r.status}`);
      }
      setSavedAt(new Date());
    } catch (e: any) {
      setError(e?.message ?? "Error guardando");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6 max-w-4xl mx-auto pb-32">
      <Section
        emoji="📋"
        title="Brief de marca"
        description="Resumen del posicionamiento, tono y audiencia. Se usa para adaptar el copy generado por IA en publicaciones multi-cliente."
      >
        <textarea
          value={form.brandBrief ?? ""}
          onChange={(e) => patch("brandBrief", e.target.value)}
          rows={5}
          placeholder="Ej: Clínica capilar de referencia en la Costa del Sol. Tono profesional pero cercano. Audiencia: 35-55. Eslogan: 'la seguridad comienza con la excelencia'…"
          className="w-full px-3 py-2 rounded-lg border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
        />
        <p className="mt-1 text-[11px] text-slate-500">
          Cuanto más concreto, mejor adaptará la IA. Sugerencia: incluye sector + tono + audiencia + eslóganes + cosas a evitar.
        </p>
      </Section>

      <Section emoji="🎨" title="Branding" description="Logo, fuente y colores corporativos que se aplican al generar imágenes.">
        <div className="space-y-4">
          <WebsiteAnalyzer
            value={form.website}
            onChange={(v) => patch("website", v)}
            clientId={form.id}
            onAnalyzed={(out) => {
              patch("brandColorPrimary", out.brandColors.primary);
              patch("brandColorAccent", out.brandColors.accent);
              patch("brandColorText", out.brandColors.text);
            }}
          />
          {/* Auto-show summary tras análisis */}

          <div className="grid grid-cols-3 gap-3">
            <ColorField
              label="Color primario"
              hint="Banda principal / fondo de tarjeta"
              value={form.brandColorPrimary}
              onChange={(v) => patch("brandColorPrimary", v)}
            />
            <ColorField
              label="Color de acento"
              hint="CTA, dato destacado, highlight"
              value={form.brandColorAccent}
              onChange={(v) => patch("brandColorAccent", v)}
            />
            <ColorField
              label="Texto sobre primario"
              hint="Suele ser blanco o negro"
              value={form.brandColorText}
              onChange={(v) => patch("brandColorText", v)}
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Patrón visual</label>
            <select
              value={form.visualPattern}
              onChange={(e) => patch("visualPattern", e.target.value)}
              className="w-full px-3 py-2 rounded-lg border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            >
              {VISUAL_PATTERNS.map((v) => (
                <option key={v.key} value={v.key}>
                  {v.label} — {v.description.slice(0, 80)}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Fidelidad a refs visuales · <span className="text-brand-600">{form.refsFidelity}%</span>
            </label>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={form.refsFidelity}
              onChange={(e) => patch("refsFidelity", Number(e.target.value))}
              className="w-full accent-brand-600"
            />
            <div className="mt-1 grid grid-cols-3 gap-2 text-[11px] text-slate-500">
              {FIDELITY_BANDS.map((b) => (
                <div key={b.from}>
                  <span className="font-medium text-slate-700">
                    {b.from}-{b.to}%
                  </span>{" "}
                  · {b.label.replace(/^.*?—\s*/, "")}
                </div>
              ))}
            </div>
          </div>
        </div>
      </Section>

      <Section emoji="🏷️" title="Logo corporativo" description="PNG con fondo transparente. Si subes un JPG con fondo blanco se verá feo.">
        <div className="space-y-3">
          <div className="flex gap-2">
            <input
              type="url"
              value={form.logoUrl ?? ""}
              onChange={(e) => patch("logoUrl", e.target.value)}
              placeholder="https://… (URL pública del logo, recomendado PNG)"
              className="flex-1 px-3 py-2 rounded-lg border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
            <UploadImageButton
              clientId={form.id}
              accept="image/png,image/jpeg,image/svg+xml,image/webp"
              onUploaded={(url) => patch("logoUrl", url)}
              label="Subir"
            />
          </div>
          {form.logoUrl && (
            <div className="rounded-lg border bg-slate-50 p-3 inline-block">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={form.logoUrl} alt="logo" className="max-h-24" />
            </div>
          )}
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Posición del logo en las imágenes generadas</label>
            <select
              value={form.logoPosition}
              onChange={(e) => patch("logoPosition", e.target.value)}
              className="w-full px-3 py-2 rounded-lg border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            >
              {LOGO_POSITIONS.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </Section>

      <Section
        emoji="🔠"
        title="Fuentes personalizadas"
        description="Sube al menos 2 fuentes — una Regular/Thin y otra Bold. La IA compone las headlines combinando ambas."
      >
        <FontsEditor value={form.fonts ?? []} onChange={(v) => patch("fonts", v)} />
      </Section>

      <Section
        emoji="🏆"
        title="Competidores"
        description="URLs o nombres por línea. Se analizan al pulsar 'Analizar competencia' en el modal de generación."
      >
        <textarea
          value={form.competitors ?? ""}
          onChange={(e) => patch("competitors", e.target.value)}
          rows={4}
          placeholder={"Una URL o nombre por línea, por ejemplo:\nhttps://www.competidor1.com\n@instagramcompetidor2\nMudanzas García Marbella"}
          className="w-full px-3 py-2 rounded-lg border bg-white text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand-500"
        />
        <p className="mt-1 text-[11px] text-slate-500">
          Si dejas el campo vacío, la IA buscará competidores del sector en la web automáticamente. Recomendado: 3-8.
        </p>
      </Section>

      <Section
        emoji="📐"
        title="Dimensiones por formato"
        description="Tamaño exacto al que se generan las imágenes según el tipo de publicación."
      >
        <DimensionsEditor
          value={form.dimensionsByFormat ?? defaultDimensionsByFormat()}
          onChange={(v) => patch("dimensionsByFormat", v)}
        />
      </Section>

      <Section
        emoji="🖼️"
        title="Imágenes de referencia visual"
        description="Sube fotos del cliente y categoriza cada imagen (CEO, equipo, instalaciones, pacientes, productos…). La IA analiza estas refs para extraer el ADN visual de la marca."
      >
        <RefsEditor
          value={form.referenceImages ?? []}
          onChange={(v) => patch("referenceImages", v)}
          clientId={form.id}
        />
      </Section>

      <Section
        emoji="🎨"
        title="Plantillas visuales"
        description="Sube imágenes de ejemplo o layouts que te gusten (publicaciones de referencia, mockups, plantillas). Luego, al crear cada publicación, podrás elegir una de estas plantillas y el % con que la IA la tendrá en cuenta para componer la imagen."
      >
        <TemplatesEditor
          value={form.patternTemplates ?? []}
          onChange={(v) => patch("patternTemplates", v)}
          clientId={form.id}
        />
      </Section>

      <Section
        emoji="🤖"
        title="Modelo de imagen IA"
        description="Qué modelo usar al generar imágenes para este cliente. Por defecto, el del workspace."
      >
        <select
          value={form.imageModel ?? ""}
          onChange={(e) => patch("imageModel", (e.target.value || null) as any)}
          className="w-full px-3 py-2 rounded-lg border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
        >
          <option value="">Default del workspace</option>
          <option value="openai-gpt-image-1">OpenAI gpt-image-1 (calidad alta, ~$0.04-0.17)</option>
          <option value="freepik-seedream-v4">Freepik Seedream v4 (barato, ~$0.002)</option>
        </select>
        <p className="mt-1 text-[11px] text-slate-500">
          Freepik requiere su API key en /admin/editorial. Si no está configurada, cae a OpenAI.
        </p>
      </Section>

      <Section
        emoji="📂"
        title="Refs visuales de Google Drive"
        description="Configura las refs canónicas en Drive para que la IA pueda referenciarlas al generar."
      >
        <DriveEditor
          mode={form.driveMode}
          rootId={form.driveRootId}
          subfolders={form.driveSubfolders ?? []}
          onModeChange={(v) => patch("driveMode", v)}
          onRootChange={(v) => patch("driveRootId", v)}
          onSubfoldersChange={(v) => patch("driveSubfolders", v)}
        />
      </Section>

      <Section
        emoji="📖"
        title="Guía de estilo (caché IA)"
        description="Texto que se inyecta en cada generación de imagen para mantener consistencia visual. Se calcula UNA vez por cliente y se reutiliza."
      >
        <StyleGuideManager
          clientId={form.id}
          styleGuide={form.styleGuideCached}
          onUpdated={(s) => patch("styleGuideCached", s)}
        />
      </Section>

      {/* Sticky save bar */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t shadow-lg px-4 py-3 z-30">
        <div className="max-w-4xl mx-auto flex items-center justify-between gap-3">
          <div className="text-xs text-slate-500 min-w-0 flex-1">
            {error ? (
              <span className="text-rose-600">{error}</span>
            ) : savedAt ? (
              <span className="text-emerald-600">Guardado a las {savedAt.toLocaleTimeString("es-ES")}.</span>
            ) : (
              <span>Recuerda guardar al terminar.</span>
            )}
          </div>
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium disabled:opacity-50"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Guardar
          </button>
        </div>
      </div>
    </div>
  );
}

// ===== Subcomponentes =====

function Section({
  emoji,
  title,
  description,
  children
}: {
  emoji: string;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="bg-white rounded-xl border p-5">
      <header className="mb-3">
        <h2 className="text-base font-semibold flex items-center gap-2">
          <span>{emoji}</span>
          {title}
        </h2>
        {description && <p className="mt-1 text-xs text-slate-500">{description}</p>}
      </header>
      {children}
    </section>
  );
}

function ColorField({
  label,
  hint,
  value,
  onChange
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-700 mb-1">{label}</label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value.toUpperCase())}
          className="h-9 w-12 rounded border bg-white p-0.5 cursor-pointer"
        />
        <input
          type="text"
          value={value}
          onChange={(e) => {
            const v = e.target.value.trim();
            if (/^#[0-9A-Fa-f]{0,6}$/.test(v) || v === "") onChange(v.toUpperCase());
          }}
          className="flex-1 px-2 py-1.5 rounded border bg-white text-xs font-mono focus:outline-none focus:ring-2 focus:ring-brand-500"
        />
      </div>
      {hint && <p className="mt-1 text-[10px] text-slate-500">{hint}</p>}
    </div>
  );
}

function DimensionsEditor({
  value,
  onChange
}: {
  value: DimensionsByFormat;
  onChange: (v: DimensionsByFormat) => void;
}) {
  function update(format: keyof DimensionsByFormat, patch: Partial<{ width: number; height: number; preset: string }>) {
    const next = { ...value, [format]: { ...value[format], ...patch } };
    onChange(next);
  }
  function applyPreset(format: keyof DimensionsByFormat, presetKey: string) {
    const preset = FORMAT_PRESETS.find((p) => p.key === presetKey);
    if (!preset) return;
    if (presetKey === "custom") {
      update(format, { preset: presetKey });
      return;
    }
    update(format, { preset: presetKey, width: preset.width, height: preset.height });
  }
  return (
    <div className="space-y-2">
      {EDITORIAL_FORMATS.map((f) => {
        const cur = value[f.key];
        const preset = FORMAT_PRESETS.find((p) => p.key === cur.preset);
        return (
          <div key={f.key} className="grid grid-cols-[110px_1fr_90px_30px_90px_70px] items-center gap-2">
            <div className="text-xs font-medium text-slate-700">{f.label}</div>
            <select
              value={cur.preset}
              onChange={(e) => applyPreset(f.key, e.target.value)}
              className="px-2 py-1.5 rounded border bg-white text-xs focus:outline-none focus:ring-2 focus:ring-brand-500"
            >
              {FORMAT_PRESETS.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.label} {p.key !== "custom" && `— ${p.width}×${p.height}`}
                </option>
              ))}
            </select>
            <input
              type="number"
              value={cur.width}
              onChange={(e) => update(f.key, { width: Number(e.target.value), preset: "custom" })}
              min={1}
              className="px-2 py-1.5 rounded border bg-white text-xs focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
            <div className="text-center text-xs text-slate-400">×</div>
            <input
              type="number"
              value={cur.height}
              onChange={(e) => update(f.key, { height: Number(e.target.value), preset: "custom" })}
              min={1}
              className="px-2 py-1.5 rounded border bg-white text-xs focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
            <span className="text-[11px] text-slate-500">{preset?.ratio ?? "custom"}</span>
          </div>
        );
      })}
    </div>
  );
}

function RefsEditor({
  value,
  onChange,
  clientId
}: {
  value: ReferenceImage[];
  onChange: (v: ReferenceImage[]) => void;
  clientId: string;
}) {
  const [newUrl, setNewUrl] = useState("");
  const grouped = useMemo(() => {
    const out: Record<string, number> = {};
    for (const r of value) out[r.type] = (out[r.type] ?? 0) + 1;
    return out;
  }, [value]);

  function add() {
    const url = newUrl.trim();
    if (!url) return;
    try {
      new URL(url);
    } catch {
      return;
    }
    onChange([...value, { url, type: "general" }]);
    setNewUrl("");
  }
  function remove(i: number) {
    onChange(value.filter((_, idx) => idx !== i));
  }
  function patch(i: number, patch: Partial<ReferenceImage>) {
    onChange(value.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <input
          type="url"
          value={newUrl}
          onChange={(e) => setNewUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          placeholder="URL pública de la imagen (https://…)"
          className="flex-1 px-3 py-2 rounded-lg border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
        />
        <button
          type="button"
          onClick={add}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border bg-brand-50 hover:bg-brand-100 border-brand-200 text-brand-700 text-sm"
        >
          <Plus className="h-4 w-4" />
          Añadir
        </button>
        <UploadImageButton
          clientId={clientId}
          accept="image/*"
          onUploaded={(url) => onChange([...value, { url, type: "general" }])}
          label="Subir archivo"
        />
      </div>
      {value.length === 0 ? (
        <div className="rounded-lg border border-dashed bg-slate-50 p-4 text-xs text-slate-500 text-center">
          Sin imágenes de referencia. Sube URLs de las fotos del cliente y categoriza cada una.
        </div>
      ) : (
        <>
          <div className="text-[11px] text-slate-500">
            {value.length} imágenes ·{" "}
            {Object.entries(grouped)
              .map(([k, v]) => `${k}: ${v}`)
              .join(", ")}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {value.map((ref, i) => (
              <div key={`${ref.url}-${i}`} className="relative rounded-lg border bg-white overflow-hidden">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={ref.url} alt={`ref-${i}`} className="w-full h-32 object-cover bg-slate-50" />
                <button
                  type="button"
                  onClick={() => remove(i)}
                  className="absolute top-1.5 right-1.5 inline-flex items-center justify-center h-6 w-6 rounded-full bg-rose-500 text-white shadow hover:bg-rose-600"
                  title="Quitar"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
                <div className="p-2 space-y-1.5">
                  <select
                    value={ref.type}
                    onChange={(e) => patch(i, { type: e.target.value as ReferenceImageType })}
                    className="w-full px-1.5 py-1 rounded border bg-white text-[11px] focus:outline-none focus:ring-2 focus:ring-brand-500"
                  >
                    {REFERENCE_IMAGE_TYPES.map((t) => (
                      <option key={t.key} value={t.key}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                  {(ref.type === "persona_destacada" || ref.type === "equipo" || ref.type === "pacientes_usuarios") && (
                    <input
                      type="text"
                      value={ref.personName ?? ""}
                      onChange={(e) => patch(i, { personName: e.target.value })}
                      placeholder="Nombre (ej: Rochar)"
                      className="w-full px-1.5 py-1 rounded border bg-white text-[11px] focus:outline-none focus:ring-2 focus:ring-brand-500"
                    />
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function TemplatesEditor({
  value,
  onChange,
  clientId
}: {
  value: PatternTemplate[];
  onChange: (v: PatternTemplate[]) => void;
  clientId: string;
}) {
  const [newUrl, setNewUrl] = useState("");

  function newId() {
    try {
      return crypto.randomUUID();
    } catch {
      return `tpl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    }
  }
  function addFromUrl() {
    const url = newUrl.trim();
    if (!url) return;
    try {
      new URL(url);
    } catch {
      return;
    }
    onChange([...value, { id: newId(), url, name: `Plantilla ${value.length + 1}` }]);
    setNewUrl("");
  }
  function remove(i: number) {
    onChange(value.filter((_, idx) => idx !== i));
  }
  function patch(i: number, p: Partial<PatternTemplate>) {
    onChange(value.map((t, idx) => (idx === i ? { ...t, ...p } : t)));
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <input
          type="url"
          value={newUrl}
          onChange={(e) => setNewUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addFromUrl();
            }
          }}
          placeholder="URL pública de la plantilla (https://…)"
          className="flex-1 px-3 py-2 rounded-lg border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
        />
        <button
          type="button"
          onClick={addFromUrl}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border bg-brand-50 hover:bg-brand-100 border-brand-200 text-brand-700 text-sm"
        >
          <Plus className="h-4 w-4" />
          Añadir
        </button>
        <UploadImageButton
          clientId={clientId}
          accept="image/*"
          onUploaded={(url) => onChange([...value, { id: newId(), url, name: `Plantilla ${value.length + 1}` }])}
          label="Subir plantilla"
        />
      </div>
      {value.length === 0 ? (
        <div className="rounded-lg border border-dashed bg-slate-50 p-4 text-xs text-slate-500 text-center">
          Sin plantillas. Sube imágenes de ejemplo/layout que quieras que la IA tome como guía de estilo.
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          {value.map((tpl, i) => (
            <div key={tpl.id} className="relative rounded-lg border bg-white overflow-hidden">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={tpl.url} alt={tpl.name} className="w-full h-32 object-cover bg-slate-50" />
              <button
                type="button"
                onClick={() => remove(i)}
                className="absolute top-1.5 right-1.5 inline-flex items-center justify-center h-6 w-6 rounded-full bg-rose-500 text-white shadow hover:bg-rose-600"
                title="Quitar"
              >
                <X className="h-3.5 w-3.5" />
              </button>
              <div className="p-2 space-y-1.5">
                <input
                  type="text"
                  value={tpl.name}
                  onChange={(e) => patch(i, { name: e.target.value })}
                  placeholder="Nombre de la plantilla"
                  className="w-full px-1.5 py-1 rounded border bg-white text-[11px] font-medium focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
                <input
                  type="text"
                  value={tpl.notes ?? ""}
                  onChange={(e) => patch(i, { notes: e.target.value })}
                  placeholder="Notas para la IA (opcional)"
                  className="w-full px-1.5 py-1 rounded border bg-white text-[11px] focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function FontsEditor({ value, onChange }: { value: FontEntry[]; onChange: (v: FontEntry[]) => void }) {
  const [newUrl, setNewUrl] = useState("");
  const [newName, setNewName] = useState("");
  function add() {
    const url = newUrl.trim();
    const name = newName.trim();
    if (!url || !name) return;
    try {
      new URL(url);
    } catch {
      return;
    }
    onChange([...value, { url, name, weight: value.length === 0 ? "regular" : "bold" }]);
    setNewUrl("");
    setNewName("");
  }
  function remove(i: number) {
    onChange(value.filter((_, idx) => idx !== i));
  }
  function patch(i: number, patch: Partial<FontEntry>) {
    onChange(value.map((f, idx) => (idx === i ? { ...f, ...patch } : f)));
  }
  return (
    <div className="space-y-2">
      {value.map((f, i) => (
        <div key={`${f.url}-${i}`} className="grid grid-cols-[1fr_1fr_120px_70px] items-center gap-2">
          <input
            value={f.name}
            onChange={(e) => patch(i, { name: e.target.value })}
            className="px-2 py-1.5 rounded border bg-white text-xs"
          />
          <input
            value={f.url}
            onChange={(e) => patch(i, { url: e.target.value })}
            className="px-2 py-1.5 rounded border bg-white text-xs font-mono"
          />
          <select
            value={f.weight}
            onChange={(e) => patch(i, { weight: e.target.value as "regular" | "bold" })}
            className="px-2 py-1.5 rounded border bg-white text-xs"
          >
            {FONT_WEIGHTS.map((w) => (
              <option key={w.key} value={w.key}>
                {w.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => remove(i)}
            className="inline-flex items-center justify-center gap-1 px-2 py-1.5 rounded border bg-rose-50 hover:bg-rose-100 border-rose-200 text-rose-700 text-xs"
          >
            <Trash2 className="h-3 w-3" />
            Quitar
          </button>
        </div>
      ))}
      <div className="grid grid-cols-[1fr_1fr_auto] items-center gap-2 pt-2 border-t">
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="Nombre fuente (ej: Montserrat Bold)"
          className="px-2 py-1.5 rounded border bg-white text-xs"
        />
        <input
          value={newUrl}
          onChange={(e) => setNewUrl(e.target.value)}
          placeholder="URL del .ttf/.otf/.woff"
          className="px-2 py-1.5 rounded border bg-white text-xs font-mono"
        />
        <button
          type="button"
          onClick={add}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border bg-brand-50 hover:bg-brand-100 border-brand-200 text-brand-700 text-xs"
        >
          <Plus className="h-3.5 w-3.5" />
          Añadir fuente
        </button>
      </div>
      <p className="text-[11px] text-slate-500">
        Recomendado: sube al menos 2 fuentes — una Regular/Thin y otra Bold. Sólo se sube 1 fuente → se usa esa para todo;
        ninguna → se usa Poppins Bold por defecto.
      </p>
    </div>
  );
}

function WebsiteAnalyzer({
  value,
  onChange,
  clientId,
  onAnalyzed
}: {
  value: string | null;
  onChange: (v: string) => void;
  clientId: string;
  onAnalyzed: (out: { brandColors: { primary: string; accent: string; text: string }; summary: string }) => void;
}) {
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<any>(null);
  async function run() {
    if (!value) {
      setError("Introduce primero la URL");
      return;
    }
    setRunning(true);
    setError(null);
    const r = await fetch(`/api/v1/clients/${clientId}/analyze-website`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: value, save: true })
    });
    setRunning(false);
    const j = await r.json();
    if (!r.ok) {
      setError(j?.error?.message ?? `Error ${r.status}`);
      return;
    }
    setResult(j);
    onAnalyzed(j);
  }
  return (
    <div>
      <label className="block text-xs font-medium text-slate-700 mb-1">Página web del cliente</label>
      <div className="flex gap-2">
        <input
          type="url"
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder="https://example.com"
          className="flex-1 px-3 py-2 rounded-lg border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
        />
        <button
          type="button"
          onClick={run}
          disabled={running || !value}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border bg-violet-50 hover:bg-violet-100 border-violet-200 text-violet-700 text-xs disabled:opacity-50"
        >
          {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "🤖"}
          Analizar con IA
        </button>
      </div>
      <p className="mt-1 text-[11px] text-slate-500">
        Lee la web pública y extrae paleta de colores y resumen de marca. Los colores se aplican automáticamente arriba.
      </p>
      {error && <p className="mt-2 text-[11px] text-rose-600">{error}</p>}
      {result && (
        <details className="mt-2 rounded-lg border bg-violet-50/40 border-violet-200" open>
          <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-violet-900">
            ✓ Análisis completado — paleta aplicada
          </summary>
          <div className="px-3 py-2 border-t border-violet-200 bg-white text-xs space-y-1">
            <div className="text-slate-700">{result.summary}</div>
            {result.detectedFonts?.length > 0 && (
              <div className="text-[11px] text-slate-500">
                <strong>Fuentes detectadas:</strong> {result.detectedFonts.join(", ")}
              </div>
            )}
          </div>
        </details>
      )}
    </div>
  );
}

function StyleGuideManager({
  clientId,
  styleGuide,
  onUpdated
}: {
  clientId: string;
  styleGuide: string | null;
  onUpdated: (s: string) => void;
}) {
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function regen() {
    setRunning(true);
    setError(null);
    const r = await fetch(`/api/v1/clients/${clientId}/generate-style-guide`, {
      method: "POST"
    });
    setRunning(false);
    const j = await r.json();
    if (!r.ok) {
      setError(j?.error?.message ?? `Error ${r.status}`);
      return;
    }
    onUpdated(j.styleGuide);
  }
  return (
    <div className="space-y-2">
      {styleGuide ? (
        <details className="rounded-lg border bg-emerald-50/40 border-emerald-200">
          <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-emerald-900">
            ✓ Guía cacheada ({styleGuide.length} caracteres)
          </summary>
          <pre className="px-3 py-2 text-[11px] whitespace-pre-wrap font-sans text-slate-700 border-t border-emerald-200 bg-white max-h-80 overflow-y-auto">
            {styleGuide}
          </pre>
        </details>
      ) : (
        <div className="rounded-lg border border-dashed bg-slate-50 p-3 text-xs text-slate-500">
          Sin guía cacheada. Sube refs visuales arriba y luego pulsa "Generar guía con IA".
        </div>
      )}
      <button
        type="button"
        onClick={regen}
        disabled={running}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium disabled:opacity-50"
      >
        {running && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        {styleGuide ? "Regenerar guía con IA" : "Generar guía con IA"}
      </button>
      {error && <p className="text-[11px] text-rose-600">{error}</p>}
      <p className="text-[11px] text-slate-500">
        Tarda 10-25s. Se calcula a partir de las imágenes de referencia que tengas categorizadas más arriba.
      </p>
    </div>
  );
}

function DriveEditor({
  mode,
  rootId,
  subfolders,
  onModeChange,
  onRootChange,
  onSubfoldersChange
}: {
  mode: string;
  rootId: string | null;
  subfolders: DriveSubfolder[];
  onModeChange: (v: string) => void;
  onRootChange: (v: string | null) => void;
  onSubfoldersChange: (v: DriveSubfolder[]) => void;
}) {
  function addSub() {
    onSubfoldersChange([...subfolders, { name: "", id: "", type: "otros" }]);
  }
  function removeSub(i: number) {
    onSubfoldersChange(subfolders.filter((_, idx) => idx !== i));
  }
  function patchSub(i: number, p: Partial<DriveSubfolder>) {
    onSubfoldersChange(subfolders.map((s, idx) => (idx === i ? { ...s, ...p } : s)));
  }
  const isConfigured = mode === "configured";
  return (
    <div className="space-y-3">
      <div>
        <label className="block text-xs font-medium text-slate-700 mb-1">Modo Drive refs</label>
        <div className="space-y-1.5">
          {DRIVE_MODES.map((m) => (
            <label key={m.key} className="flex items-center gap-2 text-xs cursor-pointer">
              <input
                type="radio"
                checked={mode === m.key}
                onChange={() => onModeChange(m.key)}
                className="accent-brand-600"
              />
              {m.label}
            </label>
          ))}
        </div>
      </div>

      {isConfigured && (
        <>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Carpeta raíz del cliente (ID o URL de Drive)</label>
            <input
              type="text"
              value={rootId ?? ""}
              onChange={(e) => onRootChange(e.target.value || null)}
              placeholder="1ABCdefGhIjKlmNoPqr… o https://drive.google.com/drive/folders/…"
              className="w-full px-3 py-2 rounded-lg border bg-white text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
            <p className="mt-1 text-[11px] text-slate-500">
              Pega el ID de la carpeta o el link completo. Lo extraeremos automáticamente.
            </p>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-medium text-slate-700">Subcarpetas (opcional)</label>
              <button
                type="button"
                onClick={addSub}
                className="inline-flex items-center gap-1 px-2 py-1 rounded border bg-brand-50 hover:bg-brand-100 border-brand-200 text-brand-700 text-[11px]"
              >
                <Plus className="h-3 w-3" />
                Añadir subcarpeta
              </button>
            </div>
            {subfolders.length === 0 ? (
              <p className="text-[11px] text-slate-500">
                Sin subcarpetas. Cada subcarpeta tiene un nombre libre, un ID de Drive y un tipo semántico para que la IA
                sepa cuándo usarla.
              </p>
            ) : (
              <div className="space-y-2">
                {subfolders.map((s, i) => (
                  <div key={i} className="grid grid-cols-[1fr_1fr_180px_70px] items-center gap-2">
                    <input
                      value={s.name}
                      onChange={(e) => patchSub(i, { name: e.target.value })}
                      placeholder="Nombre (ej: Rochar)"
                      className="px-2 py-1.5 rounded border bg-white text-xs"
                    />
                    <input
                      value={s.id}
                      onChange={(e) => patchSub(i, { id: e.target.value })}
                      placeholder="ID Drive"
                      className="px-2 py-1.5 rounded border bg-white text-xs font-mono"
                    />
                    <select
                      value={s.type}
                      onChange={(e) => patchSub(i, { type: e.target.value as SubfolderType })}
                      className="px-2 py-1.5 rounded border bg-white text-xs"
                    >
                      {SUBFOLDER_TYPES.map((t) => (
                        <option key={t.key} value={t.key}>
                          {t.label}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => removeSub(i)}
                      className="inline-flex items-center justify-center gap-1 px-2 py-1.5 rounded border bg-rose-50 hover:bg-rose-100 border-rose-200 text-rose-700 text-xs"
                    >
                      <Trash2 className="h-3 w-3" />
                      Quitar
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Botón "Subir archivo" con file picker oculto. Sube a R2 via el
 * endpoint /api/v1/files/upload y llama onUploaded con la URL
 * pública resultante.
 *
 * Asociamos cada subida al cliente (targetType=CLIENT) para que el
 * File quede vinculado en BD — útil para encontrar después qué
 * imágenes pertenecen a qué cliente y para que la limpieza por
 * eliminación de cliente cascadee.
 *
 * Si el endpoint devuelve URL signed (sin STORAGE_PUBLIC_URL
 * configurado), avisamos al user porque expira en 1h y no sirve
 * para campos persistentes.
 */
function UploadImageButton({
  clientId,
  accept,
  onUploaded,
  label
}: {
  clientId: string;
  accept: string;
  onUploaded: (url: string) => void;
  label: string;
}) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputId = useMemo(
    () => `upload-img-${Math.random().toString(36).slice(2, 10)}`,
    []
  );

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("targetType", "CLIENT");
      if (clientId) fd.append("targetId", clientId);
      const r = await fetch("/api/v1/files/upload", { method: "POST", body: fd });
      const data = await r.json().catch(() => null);
      if (!r.ok || !data?.url) {
        setError(data?.error?.message || `Subida falló (HTTP ${r.status})`);
        return;
      }
      // Heurística: si la URL contiene "X-Amz-Signature" o "Signature=",
      // es una URL firmada que expira en 1h. Aviso al user — no debería
      // guardarse en campos persistentes.
      const isSigned = /X-Amz-Signature|[?&]Signature=/.test(data.url);
      if (isSigned) {
        setError(
          "⚠️ El bucket no tiene URL pública configurada (STORAGE_PUBLIC_URL). La URL caduca en 1h. Avisa al admin para configurarlo o pega manualmente una URL pública."
        );
      }
      onUploaded(data.url);
    } catch (err: any) {
      setError(`Error: ${err?.message ?? err}`);
    } finally {
      setUploading(false);
      // Reset input para permitir subir el mismo archivo otra vez.
      e.target.value = "";
    }
  }

  return (
    <>
      <input
        id={inputId}
        type="file"
        accept={accept}
        onChange={handleFile}
        className="hidden"
      />
      <label
        htmlFor={inputId}
        className={
          "inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border text-sm cursor-pointer " +
          (uploading
            ? "bg-slate-100 text-slate-400 cursor-wait"
            : "bg-slate-50 hover:bg-slate-100 border-slate-300 text-slate-700")
        }
        title="Subir archivo desde tu dispositivo"
      >
        {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
        {label}
      </label>
      {error && (
        <span className="text-xs text-rose-600 ml-2 self-center max-w-md">{error}</span>
      )}
    </>
  );
}
