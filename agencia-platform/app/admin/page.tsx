import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import { Key, Download, Webhook, Users } from "lucide-react";

const cards = [
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
    href: "#",
    title: "Usuarios y permisos",
    description: "Próximamente: gestiona miembros, roles y permisos por proyecto.",
    icon: Users,
    disabled: true
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
