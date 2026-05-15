import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import { Key, Download, Webhook, Users, Sparkles, PencilLine, FolderKanban } from "lucide-react";

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
