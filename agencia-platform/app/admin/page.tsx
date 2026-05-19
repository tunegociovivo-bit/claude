import Link from "next/link";
import { redirect } from "next/navigation";
import PageHeader from "@/components/PageHeader";
import { prisma } from "@/lib/db/prisma";
import { getSessionWorkspaceId } from "@/lib/auth";
import type { LucideIcon } from "lucide-react";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import {
  Key,
  Download,
  Webhook,
  Users,
  Sparkles,
  PencilLine,
  FolderKanban,
  Star,
  Mic,
  Upload,
  AppWindow,
  Palette,
  Columns3,
  Shield,
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
  Volume2
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
  cards: AdminCard[];
};

export const dynamic = "force-dynamic";

const SECTIONS: AdminSection[] = [
  {
    id: "sonia",
    title: "Sonia — IA autónoma",
    accent: "violet",
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
    cards: [
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
    cards: [
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
        href: "/admin/extension",
        title: "Extensión de Chrome",
        description:
          "Grabador de reuniones y atajos de Sonia integrados en el browser del equipo.",
        icon: AppWindow
      }
    ]
  },
  {
    id: "imports",
    title: "Importaciones & migraciones",
    accent: "amber",
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
    cards: [
      {
        href: "https://claude.ai/code/session_01CA9ihZJxnRBKpd64rc1mg9",
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

const ACCENT_TO_BORDER: Record<string, string> = {
  violet: "border-l-violet-500",
  brand: "border-l-brand-500",
  blue: "border-l-blue-500",
  emerald: "border-l-emerald-500",
  amber: "border-l-amber-500",
  slate: "border-l-slate-400",
  rose: "border-l-rose-500"
};
const ACCENT_TO_TEXT: Record<string, string> = {
  violet: "text-violet-700",
  brand: "text-brand-700",
  blue: "text-blue-700",
  emerald: "text-emerald-700",
  amber: "text-amber-700",
  slate: "text-slate-600",
  rose: "text-rose-700"
};

export default async function AdminPage() {
  // Sólo admins pueden ver este panel. Si no hay sesión, el middleware ya
  // redirige a /login. Aquí gateamos a no-admins mandándolos a /.
  const session = await getServerSession(authOptions);
  const userId = (session?.user as any)?.id as string | undefined;
  const workspaceId = await getSessionWorkspaceId();
  if (!userId || !workspaceId) redirect("/login");

  const me = await prisma.membership.findFirst({
    where: { userId, workspaceId }
  });
  if (!me || me.role !== "ADMIN") {
    redirect("/");
  }

  return (
    <div className="max-w-5xl mx-auto">
      <PageHeader
        title="Administración"
        description="Configuración de la plataforma e integraciones. Solo visible para administradores."
      />

      {/* Mini-índice de secciones para saltar rápido */}
      <nav className="bg-white border rounded-xl p-3 mb-4 flex flex-wrap gap-2 text-xs">
        <span className="text-slate-400 mr-1">Ir a:</span>
        {SECTIONS.map((s) => (
          <a
            key={s.id}
            href={`#${s.id}`}
            className={`px-2 py-0.5 rounded-md bg-slate-50 hover:bg-slate-100 ${ACCENT_TO_TEXT[s.accent] ?? ""}`}
          >
            {s.title}
          </a>
        ))}
      </nav>

      <div className="space-y-6">
        {SECTIONS.map((section) => (
          <section key={section.id} id={section.id}>
            <h2
              className={`text-sm font-semibold uppercase tracking-wide pl-3 border-l-4 mb-3 ${ACCENT_TO_BORDER[section.accent] ?? "border-l-slate-400"} ${ACCENT_TO_TEXT[section.accent] ?? "text-slate-700"}`}
            >
              {section.title}
              <span className="text-slate-400 font-normal ml-2 text-[10px]">
                ({section.cards.length})
              </span>
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {section.cards.map((c) => (
                <AdminCardView key={c.title} card={c} />
              ))}
            </div>
          </section>
        ))}
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

  const baseClass =
    "bg-white rounded-xl border p-4 hover:shadow-sm hover:border-brand-200 transition";
  const cardClass = c.highlight
    ? `${baseClass} bg-gradient-to-br from-brand-50 to-violet-50 border-brand-200`
    : baseClass;

  const content = (
    <>
      <div className="flex items-center justify-between">
        <Icon
          className={`h-5 w-5 mb-2 ${c.highlight ? "text-violet-600" : "text-brand-600"}`}
        />
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
