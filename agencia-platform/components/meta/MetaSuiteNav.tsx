"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Megaphone, MessageSquare } from "lucide-react";

const links = [
  { href: "/meta", label: "Resumen META", icon: LayoutDashboard },
  { href: "/campanas-meta", label: "Campañas Meta", icon: Megaphone },
  { href: "/admin/meta-comments", label: "Comentarios Meta", icon: MessageSquare }
];

export default function MetaSuiteNav() {
  const pathname = usePathname();
  return <nav aria-label="Módulos de Meta" className="mb-5 flex flex-wrap gap-2 rounded-xl border bg-white p-2">{links.map((item) => { const Icon = item.icon; const active = item.href === "/meta" ? pathname === "/meta" : pathname.startsWith(item.href); return <Link key={item.href} href={item.href} className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold ${active ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"}`}><Icon className="h-4 w-4" />{item.label}</Link>; })}</nav>;
}
