import Link from "next/link";
import { redirect } from "next/navigation";
import PageHeader from "@/components/PageHeader";
import { prisma } from "@/lib/db/prisma";
import { getSessionWorkspaceId } from "@/lib/auth";
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
  ListChecks
} from "lucide-react";

export const dynamic = "force-dynamic";

const cards = [
  {
    href: "/admin/ai",
    title: "Configuración de IA",
    description: "Conecta Anthropic para habilitar asistente, redactor, resúmenes y tag automático.",
    icon: Sparkles
  },
  {
    href: "/admin/redactor",
    title: "Redactor IA",
    description: "Genera copy listo para Instagram, blog, email, LinkedIn, TikTok o anuncios.",
    icon: PencilLine
  },
  {
    href: "/admin/api-keys",
    title: "API keys",
    description: "Genera tokens para integrar con Make, Zapier, n8n o tu propio código.",
    icon: Key
  },
  {
    href: "/admin/asana",
    title: "Migración desde Asana",
    description: "Importa workspaces, proyectos, tareas y comentarios de Asana de forma idempotente.",
    icon: Download
  },
  {
    href: "/admin/webhooks",
    title: "Webhooks",
    description: "Dispara un POST a una URL externa (Make, Zapier, n8n) cuando algo cambia: tareas, clientes, MRR, aprobaciones.",
    icon: Webhook
  },
  {
    href: "/admin/usuarios",
    title: "Usuarios y permisos",
    description: "Añade trabajadores, asigna roles y gestiona permisos del workspace.",
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
    description: "Activa los plugins migrados en el sidebar y elige qué trabajadores pueden usarlos.",
    icon: AppWindow
  },
  {
    href: "/admin/columnas",
    title: "Columnas del Kanban",
    description: "Añade, renombra, reordena las columnas del tablero de tareas.",
    icon: Columns3
  },
  {
    href: "/admin/workspace",
    title: "Identidad del workspace",
    description: "Cambia el nombre y el logo que ven todos los miembros.",
    icon: Palette
  },
  {
    href: "/admin/seguridad",
    title: "Seguridad y copias",
    description: "Backups manuales y automáticos diarios. Histórico y descarga.",
    icon: Shield
  },
  {
    href: "/admin/auditoria",
    title: "Auditoría",
    description: "Quién hizo qué, sobre qué y cuándo. Cambios de MRR, borrados, logins.",
    icon: ListChecks
  },
  {
    href: "/admin/papelera",
    title: "Papelera",
    description: "Tareas, proyectos, documentos y clientes borrados. Recupera o purga.",
    icon: Trash2
  },
  {
    href: "/admin/errors",
    title: "Errores capturados",
    description: "Bugs auto-reportados de cliente, servidor y API. Estado, barra de tiempo, link a sesión de soporte.",
    icon: AlertOctagon
  },
  {
    href: "/admin/ia-usage",
    title: "Consumo de IA",
    description: "Cuánto está gastando cada proyecto y trabajador en Claude, GPT y Whisper.",
    icon: TrendingUp
  },
  {
    href: "/admin/reviews",
    title: "Generador de reseñas IA",
    description: "Migrado del plugin WP. Configura clientes y genera reseñas con OpenAI vía un widget embebible.",
    icon: Star
  },
  {
    href: "/admin/voice-reviews",
    title: "Voice Reviews",
    description: "Reseñas guiadas por voz: cliente graba, Whisper transcribe, Claude redacta borrador editable.",
    icon: Mic
  },
  {
    href: "/admin/editorial",
    title: "Calendario editorial",
    description: "Migrado de NV Dashboard: publicaciones multi-cliente con estados y programación.",
    icon: FileText
  },
  {
    href: "/admin/leads",
    title: "Leads (NV Leads Pro)",
    description: "Migrado: captación Google My Business + WhatsApp + plantillas + secuencias.",
    icon: MessageSquare
  },
  {
    href: "/admin/wp-import",
    title: "Importar desde WordPress",
    description: "Trae automáticamente API keys, clientes y datos de los plugins NV en hub.negociovivo.com.",
    icon: Upload
  },
  {
    href: "/admin/import-clients-list",
    title: "Importar listado de clientes",
    description: "Crea los 71 clientes del Sheet inicial con su prioridad y servicios. Idempotente — los que ya existen se saltan.",
    icon: Upload
  },
  {
    href: "/admin/import-accesos",
    title: "Importar accesos desde tarea",
    description: "Pega el contenido de la tarea con las credenciales por cliente y se vuelcan al campo Accesos de cada ficha con preview previa.",
    icon: Upload
  },
  {
    href: "/admin/import-accesos-asana",
    title: "Importar accesos desde Asana",
    description: "Lee automáticamente las 165 subtareas de la tarea CLIENTES en Asana (con sus sub-subtareas de credenciales) y vuelca todo al campo Accesos de cada cliente. Background job con progreso visible.",
    icon: KeyRound
  },
  {
    href: "https://claude.ai/code/session_01CA9ihZJxnRBKpd64rc1mg9",
    title: "Sesión de Claude (mantenimiento)",
    description: "Atajo a la conversación de Claude donde se está desarrollando esta plataforma. Para pedir cambios o consultar el estado del proyecto.",
    icon: Code2,
    external: true,
    highlight: true
  }
];

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
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {cards.map((c) => {
          const Icon = c.icon;
          if (c.disabled) {
            return (
              <div
                key={c.title}
                className="bg-white rounded-xl border p-5 opacity-60 cursor-not-allowed"
              >
                <Icon className="h-5 w-5 text-slate-400 mb-2" />
                <h3 className="font-semibold">{c.title}</h3>
                <p className="text-xs text-slate-500 mt-1">{c.description}</p>
              </div>
            );
          }

          const baseClass =
            "bg-white rounded-xl border p-5 hover:shadow-sm hover:border-brand-200 transition";
          const cardClass = c.highlight
            ? `${baseClass} bg-gradient-to-br from-brand-50 to-violet-50 border-brand-200`
            : baseClass;

          const content = (
            <>
              <div className="flex items-center justify-between">
                <Icon className={`h-5 w-5 mb-2 ${c.highlight ? "text-violet-600" : "text-brand-600"}`} />
                {c.external && <ExternalLink className="h-3.5 w-3.5 text-slate-400" />}
              </div>
              <h3 className="font-semibold">{c.title}</h3>
              <p className="text-xs text-slate-500 mt-1">{c.description}</p>
            </>
          );

          if (c.external) {
            return (
              <a
                key={c.title}
                href={c.href}
                target="_blank"
                rel="noreferrer"
                className={cardClass}
              >
                {content}
              </a>
            );
          }

          return (
            <Link key={c.title} href={c.href} className={cardClass}>
              {content}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
