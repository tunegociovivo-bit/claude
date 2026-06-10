"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Key,
  Download,
  Webhook,
  Users,
  Sparkles,
  PencilLine,
  BookOpen,
  FolderKanban,
  Star,
  Mic,
  Upload,
  AppWindow,
  Palette,
  Columns3,
  Shield,
  ServerCog,
  Mail,
  TrendingUp,
  FileText,
  MessageSquare,
  Code2,
  ExternalLink,
  AlertOctagon,
  KeyRound,
  Trash2,
  ListChecks,
  FileCheck2,
  Calendar,
  Search,
  Brain,
  Bot,
  BarChart3,
  ShieldCheck,
  Bell,
  Volume2,
  Wrench,
  Sheet
} from "lucide-react";

type AdminCard = {
  href: string;
  title: string;
  description: string;
  icon: LucideIcon;
  disabled?: boolean;
  external?: boolean;
  highlight?: boolean;
};

type AdminSection = {
  id: string;
  title: string;
  /** Color del badge de la sección (clase tailwind base, ej "violet") */
  accent: string;
  icon: LucideIcon;
  cards: AdminCard[];
};

const SECTIONS: AdminSection[] = [
  {
    id: "sonia",
    title: "Sonia — IA autónoma",
    accent: "violet",
    icon: Bot,
    cards: [
      {
        href: "/admin/sonia-dashboard",
        title: "Dashboard de Sonia",
        description:
          "Qué hace, cuánto cuesta, dónde está fallando. Coste $ por run, top tools, top clientes, errores, runs recientes con replay.",
        icon: BarChart3,
        highlight: true
      },
      {
        href: "/admin/sonia-trust",
        title: "Trust por cliente",
        description:
          "Score 0-100 por cliente sobre fiabilidad histórica. Cuando llega a 80+, activa modo autopilot (Sonia decide sin pedir aprobación en riesgo bajo/medio).",
        icon: ShieldCheck
      },
      {
        href: "/admin/nv-ia",
        title: "Configuración de Sonia",
        description:
          "Init de Sonia en el workspace: crear el user IA, proyecto buzón, modelo Claude, max steps por run.",
        icon: Bot
      },
      {
        href: "/admin/sonia-knowledge",
        title: "Conocimiento de Sonia",
        description:
          "Escribe textos de aprendizaje y sube documentos de clientes. Sonia los indexa y los usa para responder tus preguntas en el chat.",
        icon: BookOpen
      },
      {
        href: "/admin/sonia-voice-test",
        title: "Voz de Sonia (ElevenLabs)",
        description:
          "Configura la API key + voiceId y prueba la voz con textos de ejemplo. Sonia te avisará con esta voz cuando termine tareas, te conteste o necesite ayuda.",
        icon: Volume2
      },
      {
        href: "/admin/sonia-self-heal",
        title: "Auto-fix de Sonia",
        description:
          "Cuando Sonia se topa con un bug del código, un agente Claude programático abre PR con el fix y lo mergea solo. Sin esperar a nadie. Configura el PAT de GitHub una vez aquí.",
        icon: ShieldCheck,
        highlight: true
      },
      {
        href: "/admin/make-settings",
        title: "Make.com (automatizaciones)",
        description:
          "Sonia puede listar, duplicar y activar escenarios Make. Tras crear una campaña Meta Lead Ads, clona el escenario plantilla apuntando al nuevo formulario.",
        icon: Webhook
      },
      {
        href: "/admin/sonia-lessons",
        title: "Lecciones aprendidas",
        description:
          "Memoria persistente de Sonia. Lecciones manuales + auto-extraídas de tu feedback en hilos de tareas. Aplica todo lo aprendido en runs futuros.",
        icon: Brain
      },
      {
        href: "/admin/memoria-claude",
        title: "Memoria del proyecto",
        description:
          "Resumen completo del proyecto, arquitectura, gotchas, sprints y notas custom. Para pegar a Claude Code si pierde contexto.",
        icon: Brain
      }
    ]
  },
  {
    id: "ia",
    title: "IA & Herramientas",
    accent: "brand",
    icon: Sparkles,
    cards: [
      {
        href: "/admin/ai",
        title: "Configuración de IA",
        description:
          "Conecta Anthropic para habilitar asistente, redactor, resúmenes y tag automático.",
        icon: Sparkles
      },
      {
        href: "/admin/redactor",
        title: "Redactor IA",
        description:
          "Genera copy listo para Instagram, blog, email, LinkedIn, TikTok o anuncios.",
        icon: PencilLine
      },
      {
        href: "/admin/reviews",
        title: "Generador de reseñas IA",
        description:
          "Migrado del plugin WP. Configura clientes y genera reseñas con OpenAI vía un widget embebible.",
        icon: Star
      },
      {
        href: "/admin/voice-reviews",
        title: "Voice Reviews",
        description:
          "Reseñas guiadas por voz: cliente graba, Whisper transcribe, Claude redacta borrador editable.",
        icon: Mic
      },
      {
        href: "/admin/editorial",
        title: "Calendario editorial",
        description:
          "Migrado de NV Dashboard: publicaciones multi-cliente con estados y programación.",
        icon: FileText
      },
      {
        href: "/admin/busqueda",
        title: "Búsqueda semántica",
        description:
          "Estado del índice de embeddings. Re-indexa tras importar o cambiar contenido masivo. Prueba queries en vivo.",
        icon: Search
      },
      {
        href: "/admin/ia-usage",
        title: "Consumo de IA",
        description:
          "Cuánto está gastando cada proyecto y trabajador en Claude, GPT y Whisper.",
        icon: TrendingUp
      }
    ]
  },
  {
    id: "workspace",
    title: "Workspace & equipo",
    accent: "blue",
    icon: Users,
    cards: [
      {
        href: "/admin/personalizar",
        title: "Personalizar Hub",
        description:
          "Elige qué pestañas y secciones quieres ver en tu menú lateral. Preferencia personal por usuario.",
        icon: Palette
      },
      {
        href: "/admin/usuarios",
        title: "Usuarios y permisos",
        description:
          "Añade trabajadores, asigna roles y gestiona permisos del workspace.",
        icon: Users
      },
      {
        href: "/admin/proyectos",
        title: "Proyectos y acceso",
        description: "Decide qué trabajador puede entrar a qué proyecto.",
        icon: FolderKanban
      },
      {
        href: "/admin/plataformas",
        title: "Plataformas",
        description:
          "Activa los plugins migrados en el sidebar y elige qué trabajadores pueden usarlos.",
        icon: AppWindow
      },
      {
        href: "/admin/columnas",
        title: "Columnas del Kanban",
        description:
          "Añade, renombra, reordena las columnas del tablero de tareas.",
        icon: Columns3
      },
      {
        href: "/admin/task-templates",
        title: "Plantillas de tareas",
        description:
          "Crea plantillas con campos predefinidos + desplegables personalizables. Al crear una tarea eliges la plantilla y se prerellena.",
        icon: ListChecks
      },
      {
        href: "/admin/workspace",
        title: "Identidad del workspace",
        description: "Cambia el nombre y el logo que ven todos los miembros.",
        icon: Palette
      },
      {
        href: "/admin/notificaciones",
        title: "Notificaciones",
        description:
          "Configura plantillas + canales (push, email, WhatsApp) por evento.",
        icon: Bell
      }
    ]
  },
  {
    id: "comms",
    title: "Comunicación & clientes",
    accent: "emerald",
    icon: MessageSquare,
    cards: [
      {
        href: "/gmb-hub",
        title: "GMB Hub",
        description:
          "Gestión de fichas de Google My Business: reseñas, respuestas (manual/IA), tono por ficha. Las reseñas entran vía Make.",
        icon: Star
      },
      {
        href: "/admin/voz",
        title: "Llamadas de voz (Sonia)",
        description:
          "Configura Vapi para que Sonia haga llamadas conversacionales reales (cualificar leads, recordatorios). Transcripción y resumen automáticos.",
        icon: MessageSquare
      },
      {
        href: "/admin/leads",
        title: "Leads (NV Leads Pro)",
        description:
          "Migrado: captación Google My Business + WhatsApp + plantillas + secuencias.",
        icon: MessageSquare
      },
      {
        href: "/admin/entregables",
        title: "Entregables",
        description:
          "PDFs, mockups, vídeos para aprobación del cliente desde su portal.",
        icon: FileCheck2
      },
      {
        href: "/admin/webhooks",
        title: "Webhooks salientes",
        description:
          "Dispara un POST a una URL externa (Make, Zapier, n8n) cuando algo cambia: tareas, clientes, MRR, aprobaciones.",
        icon: Webhook
      },
      {
        href: "/perfil#gcal",
        title: "Google Calendar",
        description:
          "Cada miembro conecta su cuenta en /perfil. Bidireccional: tus eventos viajan en ambas direcciones.",
        icon: Calendar
      },
      {
        href: "/admin/integrations/google-sheets",
        title: "Google Sheets (gspread)",
        description:
          "Pega el service_account.json para que Sonia pueda leer y escribir en hojas de cálculo. Comparte cada hoja con el email del service account (Editor).",
        icon: Sheet
      },
      {
        href: "/admin/extension",
        title: "Extensión de Chrome",
        description:
          "Grabador de reuniones y atajos de Sonia integrados en el browser del equipo.",
        icon: AppWindow
      }
    ]
  },
  {
    id: "facturacion",
    title: "Facturación",
    accent: "emerald",
    icon: FileText,
    cards: [
      {
        href: "/facturacion",
        title: "Facturación",
        description:
          "Elige la empresa emisora y emite facturas, presupuestos, rectificativas y proformas. Recurrentes, multi-divisa (€/$), método de pago por factura (Stripe, transferencia, remesa…), diseño profesional, duplicar, marcar como pagada y exportar a Factura-e.",
        icon: FileText,
        highlight: true
      },
      {
        href: "/admin/integrations/holded",
        title: "Holded (contabilidad)",
        description:
          "Conecta tu cuenta de Holded con su API key para descargar y gestionar facturas y contactos de Negocio Vivo S.C.A. Sonia podrá consultarlos y crear facturas/presupuestos.",
        icon: Key
      }
    ]
  },
  {
    id: "imports",
    title: "Importaciones & migraciones",
    accent: "amber",
    icon: Download,
    cards: [
      {
        href: "/admin/asana",
        title: "Migración desde Asana",
        description:
          "Importa workspaces, proyectos, tareas y comentarios de Asana de forma idempotente.",
        icon: Download
      },
      {
        href: "/admin/wp-import",
        title: "Importar desde WordPress",
        description:
          "Trae automáticamente API keys, clientes y datos de los plugins NV en hub.negociovivo.com.",
        icon: Upload
      },
      {
        href: "/admin/import",
        title: "Importar clientes y facturas (PDF/CSV/Excel)",
        description:
          "Sube un listado en PDF, CSV o Excel para crear clientes o facturas. Si el cliente ya existe, solo rellena los datos que le falten — nunca sobrescribe. Vista previa antes de confirmar.",
        icon: Upload,
        highlight: true
      },
      {
        href: "/admin/import-clients-list",
        title: "Importar listado de clientes",
        description:
          "Crea los clientes del Sheet inicial con su prioridad y servicios. Idempotente — los que ya existen se saltan.",
        icon: Upload
      },
      {
        href: "/admin/import-accesos",
        title: "Importar accesos desde tarea",
        description:
          "Pega el contenido de la tarea con las credenciales por cliente y se vuelcan al campo Accesos de cada ficha con preview previa.",
        icon: Upload
      },
      {
        href: "/admin/import-accesos-asana",
        title: "Importar accesos desde Asana",
        description:
          "Lee automáticamente las subtareas de la tarea CLIENTES en Asana (con sus sub-subtareas de credenciales) y vuelca todo al campo Accesos de cada cliente.",
        icon: KeyRound
      }
    ]
  },
  {
    id: "security",
    title: "Seguridad & auditoría",
    accent: "slate",
    icon: Shield,
    cards: [
      {
        href: "/admin/api-keys",
        title: "API keys",
        description:
          "Genera tokens para integrar con Make, Zapier, n8n o tu propio código.",
        icon: Key
      },
      {
        href: "/admin/seguridad",
        title: "Seguridad y copias",
        description:
          "Backups manuales y automáticos diarios. Histórico y descarga.",
        icon: Shield
      },
      {
        href: "/admin/infraestructura",
        title: "Infraestructura y backups",
        description:
          "Inventario de TODAS las plataformas externas (GitHub, Railway, fal, Make, Meta, R2…), su estado en vivo y el runbook para recuperar el proyecto completo si algo se rompe.",
        icon: ServerCog,
        highlight: true
      },
      {
        href: "/admin/secretos",
        title: "Bóveda de credenciales",
        description:
          "Todas las APIs y tokens del workspace, cifrados. Revélalos con tu contraseña para copiarlos y usarlos en otro sitio. Cada revelación queda auditada.",
        icon: KeyRound
      },
      {
        href: "/perfil/correo",
        title: "Mi correo",
        description:
          "Tu cuenta de correo personal (IMAP/SMTP) para que Sonia consulte y envíe tus emails. Cada trabajador conecta el suyo en su perfil; aquí tienes el acceso directo al tuyo.",
        icon: Mail
      },
      {
        href: "/admin/auditoria",
        title: "Auditoría",
        description:
          "Quién hizo qué, sobre qué y cuándo. Cambios de MRR, borrados, logins.",
        icon: ListChecks
      },
      {
        href: "/admin/papelera",
        title: "Papelera",
        description:
          "Tareas, proyectos, documentos y clientes borrados. Recupera o purga.",
        icon: Trash2
      },
      {
        href: "/admin/errors",
        title: "Errores capturados",
        description:
          "Bugs auto-reportados de cliente, servidor y API. Estado, barra de tiempo, link a sesión de soporte.",
        icon: AlertOctagon
      }
    ]
  },
  {
    id: "maint",
    title: "Mantenimiento",
    accent: "rose",
    icon: Wrench,
    cards: [
      {
        href: "https://claude.ai/code/session_0176NZVYVByJWdJ3qvH85bnb",
        title: "Sesión de Claude (mantenimiento)",
        description:
          "Atajo a la conversación de Claude donde se está desarrollando esta plataforma. Para pedir cambios o consultar el estado del proyecto.",
        icon: Code2,
        external: true,
        highlight: true
      }
    ]
  }
];

const ACCENT_TO_TEXT: Record<string, string> = {
  violet: "text-violet-700",
  brand: "text-brand-700",
  blue: "text-blue-700",
  emerald: "text-emerald-700",
  amber: "text-amber-700",
  slate: "text-slate-600",
  rose: "text-rose-700"
};
const ACCENT_TO_ACTIVE: Record<string, string> = {
  violet: "bg-violet-50 text-violet-800",
  brand: "bg-brand-50 text-brand-800",
  blue: "bg-blue-50 text-blue-800",
  emerald: "bg-emerald-50 text-emerald-800",
  amber: "bg-amber-50 text-amber-800",
  slate: "bg-slate-100 text-slate-800",
  rose: "bg-rose-50 text-rose-800"
};

export default function AdminConsole({
  accessibleHrefs = null
}: {
  /** null = acceso total (ADMIN): se muestran todas las tarjetas.
   *  Array = solo se muestran las tarjetas con href incluido (miembro con
   *  acceso parcial concedido). */
  accessibleHrefs?: string[] | null;
}) {
  const [activeId, setActiveId] = useState<string>(SECTIONS[0].id);
  const [query, setQuery] = useState("");

  // Secciones filtradas por lo que el usuario puede ver. Las secciones que se
  // quedan sin tarjetas visibles desaparecen del menú.
  const sections = useMemo(() => {
    if (!accessibleHrefs) return SECTIONS;
    const allowed = new Set(accessibleHrefs);
    return SECTIONS.map((s) => ({ ...s, cards: s.cards.filter((c) => allowed.has(c.href)) })).filter(
      (s) => s.cards.length > 0
    );
  }, [accessibleHrefs]);

  const q = query.trim().toLowerCase();
  const searchResults = useMemo(() => {
    if (!q) return null;
    const out: AdminCard[] = [];
    for (const s of sections) {
      for (const c of s.cards) {
        if (c.title.toLowerCase().includes(q) || c.description.toLowerCase().includes(q)) out.push(c);
      }
    }
    return out;
  }, [q, sections]);

  if (sections.length === 0) {
    return <p className="text-sm text-slate-400">No tienes ninguna sección de administración asignada.</p>;
  }

  const active = sections.find((s) => s.id === activeId) ?? sections[0];

  return (
    <div>
      {/* Buscador */}
      <div className="relative mb-4">
        <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar ajuste… (p. ej. facturación, voz, backups)"
          className="w-full pl-9 pr-3 py-2 rounded-lg border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
        />
      </div>

      {/* Selector de sección en móvil */}
      {!q && (
        <div className="md:hidden mb-4">
          <select
            value={activeId}
            onChange={(e) => setActiveId(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border bg-white text-sm"
          >
            {sections.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title} ({s.cards.length})
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="md:flex md:gap-6">
        {/* Menú lateral estilo Notion */}
        <nav className="hidden md:block w-56 shrink-0">
          <div className="text-[10px] uppercase tracking-wide text-slate-400 font-semibold px-2 mb-1">
            Secciones
          </div>
          <div className="space-y-0.5">
            {sections.map((s) => {
              const Icon = s.icon;
              const isActive = !q && s.id === activeId;
              return (
                <button
                  key={s.id}
                  onClick={() => {
                    setActiveId(s.id);
                    setQuery("");
                  }}
                  className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-sm text-left transition-colors ${
                    isActive ? ACCENT_TO_ACTIVE[s.accent] ?? "bg-slate-100" : "text-slate-600 hover:bg-slate-100"
                  }`}
                >
                  <Icon className={`h-4 w-4 shrink-0 ${isActive ? "" : ACCENT_TO_TEXT[s.accent] ?? ""}`} />
                  <span className="flex-1 truncate">{s.title}</span>
                  <span className="text-[10px] text-slate-400">{s.cards.length}</span>
                </button>
              );
            })}
          </div>
        </nav>

        {/* Contenido */}
        <div className="flex-1 min-w-0">
          {q ? (
            <>
              <h2 className="text-sm font-semibold text-slate-700 mb-3">
                Resultados de “{query}”
                <span className="text-slate-400 font-normal ml-2 text-[10px]">({searchResults?.length ?? 0})</span>
              </h2>
              {searchResults && searchResults.length > 0 ? (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                  {searchResults.map((c) => (
                    <AdminCardView key={c.title} card={c} />
                  ))}
                </div>
              ) : (
                <p className="text-sm text-slate-400">No hay ajustes que coincidan.</p>
              )}
            </>
          ) : (
            <>
              <h2 className={`text-sm font-semibold uppercase tracking-wide mb-3 ${ACCENT_TO_TEXT[active.accent] ?? "text-slate-700"}`}>
                {active.title}
                <span className="text-slate-400 font-normal ml-2 text-[10px]">({active.cards.length})</span>
              </h2>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                {active.cards.map((c) => (
                  <AdminCardView key={c.title} card={c} />
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function AdminCardView({ card: c }: { card: AdminCard }) {
  const Icon = c.icon;
  if (c.disabled) {
    return (
      <div className="bg-white rounded-xl border p-4 opacity-60 cursor-not-allowed">
        <Icon className="h-5 w-5 text-slate-400 mb-2" />
        <h3 className="font-semibold text-sm">{c.title}</h3>
        <p className="text-xs text-slate-500 mt-1">{c.description}</p>
      </div>
    );
  }

  const baseClass = "bg-white rounded-xl border p-4 hover:shadow-sm hover:border-brand-200 transition";
  const cardClass = c.highlight
    ? `${baseClass} bg-gradient-to-br from-brand-50 to-violet-50 border-brand-200`
    : baseClass;

  const content = (
    <>
      <div className="flex items-center justify-between">
        <Icon className={`h-5 w-5 mb-2 ${c.highlight ? "text-violet-600" : "text-brand-600"}`} />
        {c.external && <ExternalLink className="h-3.5 w-3.5 text-slate-400" />}
      </div>
      <h3 className="font-semibold text-sm">{c.title}</h3>
      <p className="text-xs text-slate-500 mt-1">{c.description}</p>
    </>
  );

  if (c.external) {
    return (
      <a href={c.href} target="_blank" rel="noreferrer" className={cardClass}>
        {content}
      </a>
    );
  }

  return (
    <Link href={c.href} className={cardClass}>
      {content}
    </Link>
  );
}
