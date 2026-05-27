"use client";

import { useEffect, useState } from "react";
import PageHeader from "@/components/PageHeader";
import {
  Plus,
  Loader2,
  Trash2,
  Pencil,
  Save,
  X,
  GripVertical,
  ArrowDown,
  ArrowUp,
  ListChecks
} from "lucide-react";

type FieldType =
  | "text"
  | "textarea"
  | "number"
  | "date"
  | "select"
  | "multiselect"
  | "checkbox"
  | "file";

type CustomField = {
  id: string;
  label: string;
  type: FieldType;
  required?: boolean;
  options?: string[];
  placeholder?: string;
  defaultValue?: any;
};

type TaskTemplate = {
  id: string;
  workspaceId: string;
  name: string;
  description: string | null;
  icon: string | null;
  defaultProjectId: string | null;
  defaultStatus: string | null;
  defaultPriority: "LOW" | "MEDIUM" | "HIGH" | "URGENT" | null;
  defaultAssigneeIds: string[] | null;
  defaultTags: string[] | null;
  defaultDueOffsetDays: number | null;
  bodyMarkdown: string | null;
  customFields: CustomField[] | null;
  aiWorkflow: AiWorkflow | null;
  createdAt: string;
};

type AiWorkflowStep = {
  tool: string;
  input?: Record<string, unknown>;
  why?: string;
};

type AiWorkflow = {
  description?: string;
  steps: AiWorkflowStep[];
  successCriteria?: string;
};

type Project = { id: string; name: string };
type Member = { id: string; name: string | null; email: string };

const TYPE_LABEL: Record<FieldType, string> = {
  text: "Texto corto",
  textarea: "Texto largo",
  number: "Número",
  date: "Fecha",
  select: "Desplegable (uno)",
  multiselect: "Desplegable (varios)",
  checkbox: "Sí / No",
  file: "Adjuntar archivos"
};

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

export default function TaskTemplatesClient() {
  const [items, setItems] = useState<TaskTemplate[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<TaskTemplate | null>(null);
  const [creating, setCreating] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const [tplR, prR, usR] = await Promise.all([
        fetch("/api/v1/task-templates"),
        fetch("/api/v1/projects"),
        fetch("/api/v1/users")
      ]);
      if (tplR.ok) setItems((await tplR.json()).items ?? []);
      if (prR.ok) setProjects((await prR.json()).items ?? []);
      if (usR.ok) setMembers((await usR.json()).items ?? []);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);

  async function remove(id: string) {
    if (!confirm("¿Borrar esta plantilla? Las tareas creadas a partir de ella se conservan.")) return;
    const r = await fetch(`/api/v1/task-templates/${id}`, { method: "DELETE" });
    if (r.ok) load();
  }

  return (
    <div className="max-w-5xl mx-auto">
      <PageHeader
        title="Plantillas de tareas"
        description="Crea plantillas con campos predefinidos y desplegables personalizados. Después las eliges al crear una tarea nueva."
        actions={
          <button
            onClick={() => setCreating(true)}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium"
          >
            <Plus className="h-4 w-4" />
            Nueva plantilla
          </button>
        }
      />

      {loading ? (
        <div className="text-center py-12 text-slate-500">
          <Loader2 className="h-5 w-5 animate-spin inline mr-2" /> Cargando…
        </div>
      ) : items.length === 0 ? (
        <div className="bg-white border rounded-xl p-10 text-center text-sm text-slate-500">
          Aún no tienes plantillas.{" "}
          <button onClick={() => setCreating(true)} className="text-brand-600 underline">
            Crea la primera
          </button>
          .
        </div>
      ) : (
        <div className="grid md:grid-cols-2 gap-3">
          {items.map((t) => (
            <div key={t.id} className="bg-white border rounded-xl p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="font-semibold text-sm flex items-center gap-2">
                    {t.icon && <span>{t.icon}</span>}
                    {t.name}
                  </h3>
                  {t.description && (
                    <p className="text-xs text-slate-500 mt-1 line-clamp-2">{t.description}</p>
                  )}
                </div>
                <div className="flex gap-1 shrink-0">
                  <button
                    onClick={() => setEditing(t)}
                    className="text-slate-500 hover:text-brand-600 p-1"
                    title="Editar"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => remove(t.id)}
                    className="text-slate-400 hover:text-rose-600 p-1"
                    title="Borrar"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5 mt-2 text-[11px]">
                {t.defaultProjectId && (
                  <span className="px-1.5 py-0.5 rounded bg-blue-100 text-blue-700">
                    {projects.find((p) => p.id === t.defaultProjectId)?.name ?? "proyecto"}
                  </span>
                )}
                {t.defaultPriority && (
                  <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">
                    {t.defaultPriority}
                  </span>
                )}
                {t.defaultDueOffsetDays !== null && (
                  <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-700">
                    +{t.defaultDueOffsetDays}d
                  </span>
                )}
                {Array.isArray(t.customFields) && t.customFields.length > 0 && (
                  <span className="px-1.5 py-0.5 rounded bg-violet-100 text-violet-700">
                    <ListChecks className="h-3 w-3 inline mr-0.5" />
                    {t.customFields.length} {t.customFields.length === 1 ? "campo" : "campos"} custom
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {(creating || editing) && (
        <TemplateEditor
          tpl={editing}
          projects={projects}
          members={members}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSaved={() => {
            setCreating(false);
            setEditing(null);
            load();
          }}
        />
      )}
    </div>
  );
}

function TemplateEditor({
  tpl,
  projects,
  members,
  onClose,
  onSaved
}: {
  tpl: TaskTemplate | null;
  projects: Project[];
  members: Member[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(tpl?.name ?? "");
  const [description, setDescription] = useState(tpl?.description ?? "");
  const [icon, setIcon] = useState(tpl?.icon ?? "");
  const [defaultProjectId, setDefaultProjectId] = useState(tpl?.defaultProjectId ?? "");
  const [defaultPriority, setDefaultPriority] = useState<string>(tpl?.defaultPriority ?? "");
  const [defaultAssigneeIds, setDefaultAssigneeIds] = useState<string[]>(
    tpl?.defaultAssigneeIds ?? []
  );
  const [defaultTags, setDefaultTags] = useState<string>(
    (tpl?.defaultTags ?? []).join(", ")
  );
  const [defaultDueOffsetDays, setDefaultDueOffsetDays] = useState<string>(
    tpl?.defaultDueOffsetDays !== null && tpl?.defaultDueOffsetDays !== undefined
      ? String(tpl.defaultDueOffsetDays)
      : ""
  );
  const [bodyMarkdown, setBodyMarkdown] = useState(tpl?.bodyMarkdown ?? "");
  const [customFields, setCustomFields] = useState<CustomField[]>(tpl?.customFields ?? []);
  // Workflow IA opcional. Texto JSON editable manualmente (avanzado).
  // Si vacío, Sonia improvisa como hasta ahora.
  const [aiWorkflowRaw, setAiWorkflowRaw] = useState<string>(
    tpl?.aiWorkflow ? JSON.stringify(tpl.aiWorkflow, null, 2) : ""
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function addField() {
    const idx = customFields.length;
    setCustomFields([
      ...customFields,
      {
        id: `campo_${idx + 1}`,
        label: `Campo ${idx + 1}`,
        type: "text",
        required: false
      }
    ]);
  }
  function removeField(i: number) {
    setCustomFields(customFields.filter((_, j) => j !== i));
  }
  function moveField(i: number, dir: -1 | 1) {
    const next = [...customFields];
    const j = i + dir;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    setCustomFields(next);
  }
  function patchField(i: number, patch: Partial<CustomField>) {
    setCustomFields(customFields.map((f, j) => (j === i ? { ...f, ...patch } : f)));
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const tagsArr = defaultTags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
      // Validar IDs únicos en customFields
      const ids = customFields.map((f) => f.id);
      if (new Set(ids).size !== ids.length) {
        throw new Error("Hay IDs de campos duplicados");
      }
      // Parsear y validar el workflow IA si está presente
      let aiWorkflow: AiWorkflow | null = null;
      if (aiWorkflowRaw.trim()) {
        try {
          const parsed = JSON.parse(aiWorkflowRaw);
          if (!parsed || !Array.isArray(parsed.steps)) {
            throw new Error("El workflow debe tener un campo 'steps' (array)");
          }
          for (const [i, step] of (parsed.steps as any[]).entries()) {
            if (!step.tool || typeof step.tool !== "string") {
              throw new Error(`Step ${i + 1}: falta 'tool' (string con nombre de herramienta)`);
            }
          }
          aiWorkflow = parsed;
        } catch (e: any) {
          throw new Error(`Workflow IA JSON inválido: ${e?.message ?? e}`);
        }
      }

      const payload: any = {
        name: name.trim(),
        description: description.trim() || null,
        icon: icon.trim() || null,
        defaultProjectId: defaultProjectId || null,
        defaultPriority: defaultPriority || null,
        defaultAssigneeIds: defaultAssigneeIds.length > 0 ? defaultAssigneeIds : null,
        defaultTags: tagsArr.length > 0 ? tagsArr : null,
        defaultDueOffsetDays:
          defaultDueOffsetDays.trim() === ""
            ? null
            : Number.parseInt(defaultDueOffsetDays, 10),
        bodyMarkdown: bodyMarkdown.trim() || null,
        customFields: customFields.length > 0 ? customFields : null,
        aiWorkflow
      };
      const url = tpl ? `/api/v1/task-templates/${tpl.id}` : "/api/v1/task-templates";
      const method = tpl ? "PUT" : "POST";
      const r = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j?.error?.message ?? j?.error ?? `HTTP ${r.status}`);
      }
      onSaved();
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-xl max-w-3xl w-full my-8">
        <div className="flex items-center justify-between p-4 border-b">
          <h2 className="font-semibold">
            {tpl ? `Editar plantilla` : "Nueva plantilla"}
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-5 space-y-5 max-h-[70vh] overflow-y-auto">
          {error && (
            <div className="bg-rose-50 border border-rose-200 text-rose-800 p-3 rounded-lg text-sm">
              {error}
            </div>
          )}

          {/* Nombre + icono */}
          <div className="grid grid-cols-[1fr_120px] gap-2">
            <div>
              <label className="text-xs text-slate-600 block mb-1">Nombre *</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ej: Crear campaña Meta"
                className="w-full rounded-lg border border-slate-300 p-2 text-sm"
              />
            </div>
            <div>
              <label className="text-xs text-slate-600 block mb-1">Emoji</label>
              <input
                type="text"
                value={icon}
                onChange={(e) => setIcon(e.target.value)}
                placeholder="🚀"
                maxLength={4}
                className="w-full rounded-lg border border-slate-300 p-2 text-sm text-center"
              />
            </div>
          </div>

          {/* Descripción */}
          <div>
            <label className="text-xs text-slate-600 block mb-1">
              Descripción (visible en el selector)
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="w-full rounded-lg border border-slate-300 p-2 text-sm"
              placeholder="Para qué usas esta plantilla — opcional"
            />
          </div>

          <hr className="border-slate-200" />
          <h3 className="font-semibold text-sm text-slate-700">Valores prerellenados</h3>

          {/* Proyecto + prioridad */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-600 block mb-1">Proyecto default</label>
              <select
                value={defaultProjectId}
                onChange={(e) => setDefaultProjectId(e.target.value)}
                className="w-full rounded-lg border border-slate-300 p-2 text-sm"
              >
                <option value="">— sin default —</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-slate-600 block mb-1">Prioridad default</label>
              <select
                value={defaultPriority}
                onChange={(e) => setDefaultPriority(e.target.value)}
                className="w-full rounded-lg border border-slate-300 p-2 text-sm"
              >
                <option value="">— sin default —</option>
                <option value="LOW">Baja</option>
                <option value="MEDIUM">Normal</option>
                <option value="HIGH">Alta</option>
                <option value="URGENT">Urgente</option>
              </select>
            </div>
          </div>

          {/* Assignees */}
          <div>
            <label className="text-xs text-slate-600 block mb-1">Asignados por defecto</label>
            <div className="flex flex-wrap gap-1.5">
              {members.map((m) => {
                const sel = defaultAssigneeIds.includes(m.id);
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() =>
                      setDefaultAssigneeIds(
                        sel
                          ? defaultAssigneeIds.filter((x) => x !== m.id)
                          : [...defaultAssigneeIds, m.id]
                      )
                    }
                    className={
                      "px-2 py-0.5 rounded-md text-xs " +
                      (sel
                        ? "bg-brand-100 text-brand-700"
                        : "bg-slate-100 text-slate-600 hover:bg-slate-200")
                    }
                  >
                    {m.name ?? m.email}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Tags + due offset */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-600 block mb-1">
                Tags por defecto (separados por coma)
              </label>
              <input
                type="text"
                value={defaultTags}
                onChange={(e) => setDefaultTags(e.target.value)}
                placeholder="urgente, cliente-X, redes"
                className="w-full rounded-lg border border-slate-300 p-2 text-sm"
              />
            </div>
            <div>
              <label className="text-xs text-slate-600 block mb-1">
                Vencimiento (días desde creación)
              </label>
              <input
                type="number"
                value={defaultDueOffsetDays}
                onChange={(e) => setDefaultDueOffsetDays(e.target.value)}
                placeholder="3"
                className="w-full rounded-lg border border-slate-300 p-2 text-sm"
                min={0}
                max={365}
              />
            </div>
          </div>

          {/* Cuerpo */}
          <div>
            <label className="text-xs text-slate-600 block mb-1">
              Cuerpo / descripción prerellenada
            </label>
            <textarea
              value={bodyMarkdown}
              onChange={(e) => setBodyMarkdown(e.target.value)}
              rows={5}
              className="w-full rounded-lg border border-slate-300 p-2 text-sm font-mono text-xs"
              placeholder="Texto que aparecerá ya escrito en la descripción al crear la tarea. Acepta saltos de línea."
            />
          </div>

          <hr className="border-slate-200" />

          {/* Workflow IA — avanzado */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs text-slate-600">
                Workflow IA preconfigurado <span className="text-slate-400">(opcional, avanzado)</span>
              </label>
              <span className="text-[10px] text-slate-400 italic">
                Si presente, Sonia ejecuta estos pasos linealmente sin improvisar
              </span>
            </div>
            <textarea
              value={aiWorkflowRaw}
              onChange={(e) => setAiWorkflowRaw(e.target.value)}
              rows={8}
              className="w-full rounded-lg border border-slate-300 p-2 text-xs font-mono"
              placeholder={`{
  "description": "Crear campaña Lead Ads Meta",
  "steps": [
    { "tool": "validate_credentials", "input": { "integrations": ["meta_ads"] } },
    { "tool": "meta_ads_list_pages", "why": "encontrar la page del cliente" },
    { "tool": "meta_ads_create_lead_form", "why": "form con las 3 preguntas custom" },
    { "tool": "meta_ads_create_campaign", "why": "CBO con 15€/día" },
    { "tool": "meta_ads_create_adset", "why": "targeting profesional" },
    { "tool": "generate_meta_ad_creative", "why": "imagen + textos" },
    { "tool": "meta_ads_create_ad_creative" },
    { "tool": "meta_ads_create_ad" },
    { "tool": "meta_ads_list_ads", "why": "self-verify estado final" }
  ],
  "successCriteria": "Campaña en PAUSED + ad con creative correcto + form con 3 preguntas"
}`}
            />
            <p className="mt-1 text-[11px] text-slate-500">
              JSON con array <code>steps</code>. Cada step necesita al menos <code>tool</code>.
              Opcionales: <code>input</code> (parámetros fijos), <code>why</code> (contexto).
              Si dejas el campo vacío, Sonia improvisa como hoy.
            </p>
          </div>

          <hr className="border-slate-200" />

          {/* Custom fields */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-sm text-slate-700">Campos personalizados</h3>
              <button
                type="button"
                onClick={addField}
                className="inline-flex items-center gap-1 text-xs bg-brand-600 hover:bg-brand-700 text-white px-2 py-1 rounded-md"
              >
                <Plus className="h-3 w-3" /> Añadir campo
              </button>
            </div>
            {customFields.length === 0 ? (
              <p className="text-xs text-slate-400 italic">
                Sin campos personalizados. Añade campos cuando necesites recoger info
                específica al crear la tarea (cliente destino, tipo de campaña, fecha
                concreta, etc.).
              </p>
            ) : (
              <div className="space-y-3">
                {customFields.map((f, i) => (
                  <FieldEditor
                    key={i}
                    field={f}
                    onPatch={(p) => patchField(i, p)}
                    onRemove={() => removeField(i)}
                    onMoveUp={() => moveField(i, -1)}
                    onMoveDown={() => moveField(i, 1)}
                    canMoveUp={i > 0}
                    canMoveDown={i < customFields.length - 1}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="flex justify-end gap-2 p-4 border-t">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm text-slate-600 hover:bg-slate-100"
          >
            Cancelar
          </button>
          <button
            onClick={save}
            disabled={saving || !name.trim()}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 disabled:bg-slate-300 text-white text-sm font-medium"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Guardar plantilla
          </button>
        </div>
      </div>
    </div>
  );
}

function FieldEditor({
  field,
  onPatch,
  onRemove,
  onMoveUp,
  onMoveDown,
  canMoveUp,
  canMoveDown
}: {
  field: CustomField;
  onPatch: (p: Partial<CustomField>) => void;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
}) {
  const needsOptions = field.type === "select" || field.type === "multiselect";
  return (
    <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
      <div className="flex items-start gap-2">
        <div className="flex flex-col gap-0.5 text-slate-400 pt-1">
          <button
            type="button"
            onClick={onMoveUp}
            disabled={!canMoveUp}
            className="disabled:opacity-30"
          >
            <ArrowUp className="h-3 w-3" />
          </button>
          <GripVertical className="h-3 w-3" />
          <button
            type="button"
            onClick={onMoveDown}
            disabled={!canMoveDown}
            className="disabled:opacity-30"
          >
            <ArrowDown className="h-3 w-3" />
          </button>
        </div>
        <div className="flex-1 space-y-2">
          <div className="grid grid-cols-[1fr_150px_auto] gap-2">
            <input
              type="text"
              value={field.label}
              onChange={(e) => {
                const label = e.target.value;
                // Auto-generar id si el id sigue siendo el slug del label viejo
                const oldSlug = slugify(field.label);
                const patch: Partial<CustomField> = { label };
                if (field.id === oldSlug || field.id.startsWith("campo_")) {
                  patch.id = slugify(label) || field.id;
                }
                onPatch(patch);
              }}
              placeholder="Etiqueta visible"
              className="rounded-lg border border-slate-300 p-1.5 text-sm"
            />
            <select
              value={field.type}
              onChange={(e) => onPatch({ type: e.target.value as FieldType })}
              className="rounded-lg border border-slate-300 p-1.5 text-sm"
            >
              {Object.entries(TYPE_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={onRemove}
              className="text-rose-500 hover:bg-rose-50 p-1.5 rounded"
              title="Borrar campo"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>

          <div className="grid grid-cols-[120px_1fr_auto] gap-2 items-center">
            <input
              type="text"
              value={field.id}
              onChange={(e) => onPatch({ id: slugify(e.target.value) })}
              placeholder="id_interno"
              className="rounded-lg border border-slate-300 p-1.5 text-[11px] font-mono"
            />
            <input
              type="text"
              value={field.placeholder ?? ""}
              onChange={(e) => onPatch({ placeholder: e.target.value })}
              placeholder="Placeholder (opcional)"
              className="rounded-lg border border-slate-300 p-1.5 text-xs"
            />
            <label className="text-xs inline-flex items-center gap-1">
              <input
                type="checkbox"
                checked={field.required ?? false}
                onChange={(e) => onPatch({ required: e.target.checked })}
              />
              Obligatorio
            </label>
          </div>

          {needsOptions && (
            <OptionsTextarea
              options={field.options ?? []}
              onChange={(opts) => onPatch({ options: opts })}
            />
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Textarea para editar opciones (una por línea). Mantiene state LOCAL
 * con el raw string para que el user pueda pulsar Enter y dejar líneas
 * vacías mientras teclea la siguiente opción. Sincroniza con el padre
 * solo al perder foco (onBlur), aplicando trim + filter en ese momento.
 *
 * Antes el filter(Boolean) se aplicaba en onChange, lo que eliminaba
 * la línea vacía justo al pulsar Enter — el textarea perdía la línea
 * recién creada y el cursor saltaba arriba, haciendo imposible añadir
 * nuevas filas.
 */
function OptionsTextarea({
  options,
  onChange
}: {
  options: string[];
  onChange: (opts: string[]) => void;
}) {
  const [raw, setRaw] = useState(options.join("\n"));
  // Si el padre cambia las opciones (ej. al cargar otra plantilla),
  // resetear el raw. Compara por contenido para no romper la edición
  // en curso (el usuario está tecleando, el padre tiene el último
  // commit; comparar igualados evita el "blink").
  useEffect(() => {
    const fromParent = options.join("\n");
    setRaw((curr) => (curr.trim() === fromParent.trim() ? curr : fromParent));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options.join("")]);

  return (
    <div>
      <label className="text-[11px] text-slate-600 block mb-0.5">
        Opciones (una por línea)
      </label>
      <textarea
        value={raw}
        onChange={(e) => setRaw(e.target.value)}
        onBlur={() => {
          const cleaned = raw
            .split("\n")
            .map((s) => s.trim())
            .filter(Boolean);
          onChange(cleaned);
          // Normalizar el textarea (sin líneas vacías al final) tras el blur
          setRaw(cleaned.join("\n"));
        }}
        rows={3}
        className="w-full rounded-lg border border-slate-300 p-1.5 text-xs font-mono"
        placeholder="Reva&#10;Champiso&#10;Esaem"
      />
    </div>
  );
}
