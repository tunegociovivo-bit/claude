"use client";

import { useCallback, useEffect, useState } from "react";
import clsx from "clsx";
import { CalendarDays, ClipboardCheck, LayoutDashboard, Lightbulb, PenLine, Settings, Users } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import { api } from "./ui";
import PanelView from "./PanelView";
import SitesView from "./SitesView";
import IdeasView from "./IdeasView";
import CalendarView from "./CalendarView";
import ReviewView from "./ReviewView";
import PostView from "./PostView";
import SettingsView from "./SettingsView";

export type Site = {
  id: string; clientId: string; clientName: string; siteUrl: string; wpUser: string; hasPassword: boolean; color: string;
  active: boolean; autoPublish: boolean; leadDays: number; kwCount?: number; refCount?: number; ideasCount?: number;
  plannedCount?: number; publishedCount?: number; bridgeDetected: boolean; pagesIndexed: number; [k: string]: any;
};

export type Nav = {
  tab: string;
  siteId: string;
  go: (tab: string, extra?: { post?: string; site?: string; sub?: string }) => void;
  openPost: (id: string) => void;
  setSiteFilter: (id: string) => void;
  sites: Site[];
  reloadSites: () => Promise<void>;
  settings: any;
  reloadSettings: () => Promise<void>;
};

const TABS = [
  { k: "panel", l: "Panel", i: LayoutDashboard },
  { k: "clientes", l: "Clientes", i: Users },
  { k: "propuestas", l: "Propuestas", i: Lightbulb },
  { k: "calendario", l: "Calendario", i: CalendarDays },
  { k: "revision", l: "Revisión", i: ClipboardCheck },
  { k: "ajustes", l: "Ajustes", i: Settings }
];

function readUrl() {
  if (typeof window === "undefined") return { tab: "panel", post: "", site: "", sub: "" };
  const u = new URL(window.location.href);
  return {
    tab: u.searchParams.get("tab") || (u.searchParams.get("post") ? "post" : "panel"),
    post: u.searchParams.get("post") || "",
    site: u.searchParams.get("site") || "",
    sub: u.searchParams.get("sub") || ""
  };
}

export default function SeoBlogApp() {
  // Estado inicial neutro (igual en servidor y cliente) → se lee la URL tras montar (evita hydration mismatch)
  const [route, setRoute] = useState({ tab: "", post: "", site: "", sub: "" });
  const [sites, setSites] = useState<Site[]>([]);
  const [settings, setSettings] = useState<any>(null);
  const [siteFilter, setSiteFilterState] = useState("");
  const [error, setError] = useState<string | null>(null);

  const reloadSites = useCallback(async () => {
    const d = await api<{ items: Site[] }>("/sites");
    setSites(d.items);
  }, []);
  const reloadSettings = useCallback(async () => setSettings(await api("/settings")), []);

  useEffect(() => {
    setRoute(readUrl());
    Promise.all([reloadSites(), reloadSettings()]).catch((e) => setError(e.message));
    try {
      setSiteFilterState(localStorage.getItem("nvp_site") ?? "");
    } catch {}
    const onPop = () => setRoute(readUrl());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [reloadSites, reloadSettings]);

  const go: Nav["go"] = (tab, extra = {}) => {
    const u = new URL(window.location.href);
    u.search = "";
    if (tab !== "panel" && tab !== "post") u.searchParams.set("tab", tab);
    if (extra.post) u.searchParams.set("post", extra.post);
    if (extra.site) u.searchParams.set("site", extra.site);
    if (extra.sub) u.searchParams.set("sub", extra.sub);
    window.history.pushState({}, "", u.toString());
    setRoute({ tab, post: extra.post ?? "", site: extra.site ?? "", sub: extra.sub ?? "" });
    window.scrollTo({ top: 0 });
  };
  const setSiteFilter = (id: string) => {
    setSiteFilterState(id);
    try {
      localStorage.setItem("nvp_site", id);
    } catch {}
  };
  const nav: Nav = {
    tab: route.tab, siteId: siteFilter, go, openPost: (id) => go("post", { post: id }), setSiteFilter,
    sites, reloadSites, settings, reloadSettings
  };
  const activeTab = route.tab === "post" ? "revision" : route.tab;

  return (
    <div className="max-w-7xl mx-auto">
      <PageHeader
        title="Publicador SEO"
        description="Blog SEO para las webs WordPress de los clientes: propuestas IA, calendario, redacción humanizada, imágenes con el estilo de cada cliente y publicación programada."
        actions={
          <select value={siteFilter} onChange={(e) => setSiteFilter(e.target.value)} className="px-3 py-2 rounded-lg border text-sm bg-white min-w-[220px]">
            <option value="">Todos los clientes</option>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>{s.clientName}</option>
            ))}
          </select>
        }
      />
      <nav className="flex gap-1 border-b mb-5 overflow-x-auto">
        {TABS.filter((t) => t.k !== "ajustes" || settings?.isAdmin).map((t) => (
          <button
            key={t.k}
            onClick={() => go(t.k)}
            className={clsx(
              "flex items-center gap-1.5 px-3 py-2 text-sm border-b-2 -mb-px whitespace-nowrap",
              activeTab === t.k ? "border-amber-500 text-slate-900 font-semibold" : "border-transparent text-slate-500 hover:text-slate-800"
            )}
          >
            <t.i className="h-4 w-4" />
            {t.l}
          </button>
        ))}
      </nav>
      {error && <div className="mb-4 rounded-lg bg-rose-50 border border-rose-200 p-3 text-sm text-rose-700">{error}</div>}
      {!settings || !route.tab ? (
        <div className="py-16 text-center text-slate-400 text-sm flex items-center justify-center gap-2"><PenLine className="h-4 w-4" /> Cargando…</div>
      ) : route.tab === "post" && route.post ? (
        <PostView key={route.post} id={route.post} nav={nav} />
      ) : route.tab === "clientes" ? (
        <SitesView nav={nav} openSiteId={route.site} sub={route.sub} />
      ) : route.tab === "propuestas" ? (
        <IdeasView nav={nav} />
      ) : route.tab === "calendario" ? (
        <CalendarView nav={nav} />
      ) : route.tab === "revision" ? (
        <ReviewView nav={nav} />
      ) : route.tab === "ajustes" ? (
        <SettingsView nav={nav} />
      ) : (
        <PanelView nav={nav} />
      )}
    </div>
  );
}
