"use client";

import { useCallback, useEffect, useState } from "react";
import clsx from "clsx";
import { CalendarDays, ClipboardCheck, Globe, LayoutDashboard, Lightbulb, PenLine, Settings } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import { api } from "./ui";
import PanelView from "./PanelView";
import SitesView from "./SitesView";
import IdeasView from "./IdeasView";
import CalendarView from "./CalendarView";
import ReviewView from "./ReviewView";
import PostView from "./PostView";
import SettingsView from "./SettingsView";

/** La única web del negocio en el Publicador (se crea sola con los datos de su marca). */
export type Site = {
  id: string; brandName: string; siteUrl: string; wpUser: string; hasPassword: boolean; color: string;
  active: boolean; autoPublish: boolean; leadDays: number; kwCount?: number; refCount?: number; ideasCount?: number;
  plannedCount?: number; publishedCount?: number; bridgeDetected: boolean; pagesIndexed: number; pairedAt?: string | null; [k: string]: any;
};

export type Nav = {
  tab: string;
  go: (tab: string, extra?: { post?: string; sub?: string }) => void;
  openPost: (id: string) => void;
  site: Site;
  reloadSite: () => Promise<void>;
  settings: any;
  reloadSettings: () => Promise<void>;
  isAdmin: boolean;
};

const TABS = [
  { k: "panel", l: "Panel", i: LayoutDashboard },
  { k: "propuestas", l: "Propuestas", i: Lightbulb },
  { k: "calendario", l: "Calendario", i: CalendarDays },
  { k: "revision", l: "Revisión", i: ClipboardCheck },
  { k: "web", l: "Web y conexión", i: Globe },
  { k: "ajustes", l: "Ajustes", i: Settings }
];

function readUrl() {
  if (typeof window === "undefined") return { tab: "panel", post: "", sub: "" };
  const u = new URL(window.location.href);
  return {
    tab: u.searchParams.get("tab") || (u.searchParams.get("post") ? "post" : "panel"),
    post: u.searchParams.get("post") || "",
    sub: u.searchParams.get("sub") || ""
  };
}

export default function SeoBlogApp() {
  // Estado inicial neutro (igual en servidor y cliente) → se lee la URL tras montar (evita hydration mismatch)
  const [route, setRoute] = useState({ tab: "", post: "", sub: "" });
  const [site, setSite] = useState<Site | null>(null);
  const [settings, setSettings] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const reloadSite = useCallback(async () => {
    const d = await api<{ items: Site[] }>("/sites");
    setSite(d.items[0] ?? null);
  }, []);
  const reloadSettings = useCallback(async () => setSettings(await api("/settings")), []);

  useEffect(() => {
    setRoute(readUrl());
    Promise.all([reloadSite(), reloadSettings()]).catch((e) => setError(e.message));
    const onPop = () => setRoute(readUrl());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [reloadSite, reloadSettings]);

  const go: Nav["go"] = (tab, extra = {}) => {
    const u = new URL(window.location.href);
    u.search = "";
    if (tab !== "panel" && tab !== "post") u.searchParams.set("tab", tab);
    if (extra.post) u.searchParams.set("post", extra.post);
    if (extra.sub) u.searchParams.set("sub", extra.sub);
    window.history.pushState({}, "", u.toString());
    setRoute({ tab, post: extra.post ?? "", sub: extra.sub ?? "" });
    window.scrollTo({ top: 0 });
  };
  const isAdmin = !!settings?.isAdmin;
  const activeTab = route.tab === "post" ? "revision" : route.tab;
  const nav: Nav | null = site
    ? { tab: route.tab, go, openPost: (id) => go("post", { post: id }), site, reloadSite, settings, reloadSettings, isAdmin }
    : null;

  return (
    <div className="max-w-7xl mx-auto min-w-0">
      <PageHeader
        title="Publicador SEO"
        description="Artículos de blog para tu web WordPress: propuestas con IA, calendario, redacción humanizada, imágenes con el estilo de tu marca y publicación programada."
        actions={
          site?.siteUrl ? (
            <span className="inline-flex items-center gap-1.5 rounded-lg border bg-white px-3 py-2 text-xs text-slate-600 max-w-full">
              <span className={clsx("h-2 w-2 rounded-full shrink-0", site.hasPassword ? "bg-emerald-500" : "bg-amber-500")} />
              <span className="truncate">{site.siteUrl.replace(/^https?:\/\//, "")}</span>
            </span>
          ) : null
        }
      />
      <nav className="flex gap-1 border-b mb-5 overflow-x-auto -mx-1 px-1">
        {TABS.filter((t) => t.k !== "ajustes" || isAdmin).map((t) => (
          <button
            key={t.k}
            type="button"
            onClick={() => go(t.k)}
            className={clsx(
              "flex items-center gap-1.5 px-3 py-2 text-sm border-b-2 -mb-px whitespace-nowrap",
              activeTab === t.k ? "border-brand-500 text-slate-900 font-semibold" : "border-transparent text-slate-500 hover:text-slate-800"
            )}
          >
            <t.i className="h-4 w-4" />
            {t.l}
          </button>
        ))}
      </nav>
      {error && <div className="mb-4 rounded-lg bg-rose-50 border border-rose-200 p-3 text-sm text-rose-700">{error}</div>}
      {!settings || !route.tab || !nav ? (
        !error && <div className="py-16 text-center text-slate-400 text-sm flex items-center justify-center gap-2"><PenLine className="h-4 w-4" /> Cargando…</div>
      ) : route.tab === "post" && route.post ? (
        <PostView key={route.post} id={route.post} nav={nav} />
      ) : route.tab === "web" ? (
        <SitesView nav={nav} sub={route.sub} />
      ) : route.tab === "propuestas" ? (
        <IdeasView nav={nav} />
      ) : route.tab === "calendario" ? (
        <CalendarView nav={nav} />
      ) : route.tab === "revision" ? (
        <ReviewView nav={nav} />
      ) : route.tab === "ajustes" && isAdmin ? (
        <SettingsView nav={nav} />
      ) : (
        <PanelView nav={nav} />
      )}
    </div>
  );
}
