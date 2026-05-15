import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import { Key, Download, Webhook, Users, Sparkles, PencilLine, FolderKanban, Star, Mic, Upload, AppWindow, Palette, Columns3, Shield, TrendingUp } from "lucide-react";

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
    href: "#",
    title: "Webhooks",
    description: "Próximamente: dispara eventos a sistemas externos cuando algo cambia.",
    icon: Webhook,
    disabled: true
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
    href: "/admin/wp-import",
    title: "Importar desde WordPress",
    description: "Trae automáticamente API keys, clientes y datos de los plugins NV en hub.negociovivo.com.",
    icon: Upload
  }
];

export default function AdminPage() {
  return (
    <div className="max-w-4xl mx-auto">
      <PageHeader
        title="Administración"
        description="Configuración de la plataforma e integraciones."
      />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {cards.map((c) => {
          const Icon = c.icon;
          return c.disabled ? (
            <div
              key={c.title}
              className="bg-white rounded-xl border p-5 opacity-60 cursor-not-allowed"
            >
              <Icon className="h-5 w-5 text-slate-400 mb-2" />
              <h3 className="font-semibold">{c.title}</h3>
              <p className="text-xs text-slate-500 mt-1">{c.description}</p>
            </div>
          ) : (
            <Link
              key={c.title}
              href={c.href}
              className="bg-white rounded-xl border p-5 hover:shadow-sm hover:border-brand-200 transition"
            >
              <Icon className="h-5 w-5 text-brand-600 mb-2" />
              <h3 className="font-semibold">{c.title}</h3>
              <p className="text-xs text-slate-500 mt-1">{c.description}</p>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
