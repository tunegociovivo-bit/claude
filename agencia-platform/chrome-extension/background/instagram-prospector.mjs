const RESERVED = new Set(["p", "reel", "reels", "stories", "explore", "accounts", "direct", "legal", "web", "about", "popular"]);

export function profileFromUrl(value) {
  try {
    const url = new URL(value, "https://www.instagram.com/");
    if (!["instagram.com", "www.instagram.com"].includes(url.hostname)) return null;
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length !== 1 || RESERVED.has(parts[0].toLowerCase()) || !/^[\w.]{1,30}$/.test(parts[0])) return null;
    return { handle: parts[0].toLowerCase(), url: `https://www.instagram.com/${parts[0].toLowerCase()}/` };
  } catch { return null; }
}

export function parseSources(config) {
  const entries = String(config.target || "").split(/[\n,;]/).map((s) => s.trim()).filter(Boolean);
  return entries.map((entry) => {
    if (entry.startsWith("#")) {
      const tag = entry.slice(1);
      if (!tag || /[\s/#?]/.test(tag)) throw new Error(`Hashtag no valido: ${entry}`);
      return { type: "hashtag", url: `https://www.instagram.com/explore/tags/${encodeURIComponent(tag)}/` };
    }
    const profile = profileFromUrl(entry.replace(/^@/, ""));
    if (profile && config.sourceType === "followers") return { ...profile, type: "followers" };
    let url;
    try { url = new URL(entry); } catch { throw new Error(`Indica una cuenta para seguidores o una URL de Instagram para ${config.sourceType}: ${entry}`); }
    if (!["instagram.com", "www.instagram.com"].includes(url.hostname) || url.protocol !== "https:") throw new Error("Solo se admiten URLs https de Instagram");
    if (config.sourceType === "hashtag" && /^\/explore\/tags\/[^/]+\/?$/.test(url.pathname)) return { type: "hashtag", url: url.origin + url.pathname };
    if (config.sourceType === "location" && /^\/explore\/locations\/\d+(\/[^/]+)?\/?$/.test(url.pathname)) return { type: "location", url: url.origin + url.pathname };
    if (["comments", "likers"].includes(config.sourceType) && /^\/(?:[\w.]+\/)?(?:p|reel)\/[\w-]+\/?$/.test(url.pathname)) return { type: config.sourceType, url: url.origin + url.pathname };
    throw new Error(`La fuente no corresponde a ${config.sourceType}: ${entry}`);
  });
}

// This function is serialized by chrome.scripting; keep all DOM helpers inside it.
export function inspectInstagramPage(action) {
  const main = document.querySelector("main");
  const dialog = document.querySelector('[role="dialog"]');
  const text = main?.innerText || document.body?.innerText || "";
  const blocked = /\/(accounts\/login|challenge|checkpoint)(\/|$)/.test(location.pathname)
    ? "Instagram solicita iniciar sesion o verificar la cuenta en Chrome."
    : /try again later|intentalo de nuevo mas tarde|inténtalo de nuevo más tarde|we restrict certain activity/i.test(text)
      ? "Instagram ha limitado temporalmente esta consulta."
      : /this account is private|esta cuenta es privada/i.test(text)
        ? "La cuenta es privada."
        : /page isn't available|pagina no esta disponible|página no está disponible|sorry, this page/i.test(text)
          ? "La fuente no esta disponible en Instagram." : "";
  if (blocked) return { error: blocked };
  if (action === "open-followers" || action === "open-likers") {
    const controls = [...(main || document).querySelectorAll('a, button, [role="button"]')];
    const control = controls.find((el) => {
      const label = el.textContent?.trim() || "";
      return action === "open-followers"
        ? /followers|seguidores/i.test(label)
        : /^(?:[\d.,\s]+\s*(?:likes|me gusta)|(?:liked by|les gusta a|le gusta a).+|.+(?:others|personas más))$/i.test(label);
    });
    if (!control) return { error: action === "open-followers" ? "No se encuentra el enlace de seguidores de esta cuenta." : "No se encuentra la lista de Me gusta de esta publicacion." };
    control.click();
    return { opened: true };
  }
  if (action === "profile") {
    if (!main) return { error: "Instagram no ha cargado el perfil." };
    // Exclude navigation, recommendations and Meta footer links from contact data.
    const header = main.querySelector("header") || main;
    const clone = header.cloneNode(true);
    clone.querySelectorAll('nav, footer, [role="tablist"], article, a[href*="/p/"], a[href*="/reel/"]').forEach((el) => el.remove());
    return {
      title: document.querySelector('meta[property="og:title"]')?.content || document.title,
      text: clone.innerText || clone.textContent || "",
      description: document.querySelector('meta[name="description"]')?.content || "",
      links: [...clone.querySelectorAll("a[href]")].map((a) => a.href),
      url: location.href
    };
  }
  const root = action === "members" ? dialog : main;
  if (!root) return { waiting: true, profiles: [], posts: [] };
  const profiles = [];
  const posts = [];
  for (const a of root.querySelectorAll("a[href]")) {
    const url = new URL(a.href, location.href);
    if (url.hostname !== location.hostname) continue;
    if (/^\/(?:[\w.]+\/)?(?:p|reel)\/[\w-]+\/?$/.test(url.pathname)) {
      posts.push(url.origin + url.pathname);
      continue;
    }
    if (!/^\/[\w.]{1,30}\/$/.test(url.pathname)) continue;
    if (action === "members") profiles.push({ url: a.href, evidence: "" });
    if (action === "authors" && a.closest("header")) profiles.push({ url: a.href, evidence: "" });
    if (action === "comments") {
      const row = a.closest("li");
      // A timestamp and reply control distinguish comments from the caption or mentions.
      if (!row || !row.querySelector("time") || !/reply|responder/i.test(row.innerText || "")) continue;
      const first = [...row.querySelectorAll("a[href]")].find((link) => /^\/[\w.]{1,30}\/$/.test(new URL(link.href).pathname));
      if (a !== first) continue;
      profiles.push({ url: a.href, evidence: row.innerText.slice(0, 1500) });
    }
  }
  if (action === "comments") {
    const more = [...root.querySelectorAll('button, [role="button"]')].find((el) => /load more comments|view more comments|ver más comentarios|cargar más comentarios/i.test(el.textContent || ""));
    more?.click();
  }
  const scrollables = [...root.querySelectorAll("div, ul")].filter((el) => el.scrollHeight > el.clientHeight + 20 && el.clientHeight > 100 && /auto|scroll/.test(getComputedStyle(el).overflowY));
  const scroller = scrollables.sort((a, b) => b.scrollHeight - a.scrollHeight)[0] || (action === "members" ? null : document.scrollingElement);
  if (scroller) scroller.scrollTop = scroller.scrollHeight;
  return { profiles, posts, loading: Boolean(root.querySelector('[role="progressbar"]')) };
}

export function mergeCandidates(candidates, rows, source, limit) {
  for (const row of rows) {
    const profile = profileFromUrl(row.url);
    if (!profile || profile.handle === source.handle) continue;
    const signal = source.type === "followers" ? `Sigue a @${source.handle}`
      : source.type === "comments" ? "Comentario publicado" : source.type === "likers" ? "Me gusta en publicacion"
        : source.type === "hashtag" ? "Publica en hashtag" : "Publica en ubicacion";
    let current = candidates.find((c) => c.handle === profile.handle);
    if (!current) {
      if (candidates.length >= limit) continue;
      current = { ...profile, source: source.url, signals: [], evidence: [] };
      candidates.push(current);
    }
    if (!current.signals.includes(signal)) current.signals.push(signal);
    if (row.evidence && current.evidence.length < 3 && !current.evidence.includes(row.evidence)) current.evidence.push(row.evidence);
  }
  return candidates;
}

export function buildInstagramLead(source, page, config) {
  if (page.error) throw new Error(page.error);
  const keywords = (s) => String(s || "").split(/[\n,;]/).map((x) => x.trim().toLowerCase()).filter(Boolean);
  const profileText = `${page.description || ""}\n${page.text || ""}`;
  const evidenceText = (source.evidence || []).join("\n");
  const emails = [...new Set(`${profileText}\n${(page.links || []).join("\n")}`.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [])];
  const emailTerms = keywords(config.emailKeywords);
  const email = emails.find((e) => !emailTerms.length || emailTerms.some((k) => e.toLowerCase().includes(k))) || "";
  const phone = (profileText.match(/(?:\+34\s?)?(?:[6789]\d[\s.-]?){4}\d/g) || [])[0] || "";
  const website = (page.links || []).map((link) => {
    try {
      let url = new URL(link);
      if (url.hostname === "l.instagram.com" && url.searchParams.get("u")) url = new URL(url.searchParams.get("u"));
      if (!/^https?:$/.test(url.protocol) || /(^|\.)(instagram\.com|facebook\.com|meta\.com|meta\.ai|threads\.com|muse\.ai)$/.test(url.hostname)) return "";
      return url.href;
    } catch { return ""; }
  }).find(Boolean) || "";
  const signals = [...(source.signals || [])];
  if (email) signals.push("Email publico");
  if (phone) signals.push("Telefono publico");
  if (website) signals.push("Web enlazada");
  const intentText = `${profileText}\n${evidenceText}`.toLowerCase();
  // One observed intent contributes one factor, even if it matches several keywords.
  const explicitIntent = intentText.match(/\b(?:franquiciad[oa]s?|invertir|inversor(?:a|es|as)?|inversi[oó]n|negocio propio|abrir (?:una |mi )?(?:franquicia|tienda|supermercado)|informaci[oó]n sobre franquicias)\b/i);
  const customIntent = keywords(config.intentSignals).find((k) =>
    !/^(?:emprendedor(?:a|es|as)?|email publico|telefono publico|web activa|bio profesional|actividad reciente)$/.test(k) && intentText.includes(k));
  const hasIntent = Boolean(explicitIntent || customIntent);
  if (hasIntent) signals.push("Intencion franquicia/inversion");
  const unique = [...new Set(signals)];
  const missingSignals = [];
  if (config.requireContact !== false && !email && !phone) missingSignals.push("Sin email ni telefono publico");
  const excluded = keywords(config.negativeFilters).find((term) => intentText.includes(term));
  if (excluded) missingSignals.push(`Filtro negativo: ${excluded}`);
  if (emailTerms.length && !email) missingSignals.push("Email no coincide con el filtro");
  if (unique.length < (Number(config.requiredSignalCount) || 1)) missingSignals.push(`Menos de ${config.requiredSignalCount} senales`);
  if (config.requireIntentSignal !== false && !hasIntent) missingSignals.push("Sin intencion franquicia/inversion");
  return {
    name: String(page.title || source.handle).replace(/\s*[•|]\s*(?:Instagram|Fotos y v[ií]deos de Instagram).*$/i, "").trim(),
    handle: `@${source.handle}`, email, phone, website, city: "", source: source.source || source.url,
    tag: "Agente interno", score: Math.min(95, 40 + unique.length * 10 + (hasIntent ? 15 : 0)),
    status: excluded ? "Descartado" : missingSignals.length ? "Insuficiente" : "Valido", signals: unique, missingSignals,
    evidence: [...(source.evidence || []), ...(hasIntent ? [`Senal observada: ${explicitIntent?.[0] || customIntent}`] : [])]
  };
}

export async function discoverInstagramCandidates(config, io, progress = async () => {}) {
  const sources = parseSources(config);
  const limit = Math.max(1, Math.min(Number(config.limit) || 25, 1000));
  const candidates = [];
  const skipped = [];
  const until = Date.now() + 90000;
  const perSourceLimit = Math.ceil(limit / Math.max(1, sources.length));
  for (const source of sources) {
    if (Date.now() >= until) break;
    const initialCount = candidates.length;
    await io.navigate(source.url);
    if (["followers", "likers"].includes(source.type)) {
      const opened = await io.inspect(source.type === "followers" ? "open-followers" : "open-likers");
      if (opened.error) { skipped.push(`${source.url}: ${opened.error}`); continue; }
      await io.pause();
    }
    const mode = ["followers", "likers"].includes(source.type) ? "members" : source.type === "comments" ? "comments" : "posts";
    const seenRows = new Set();
    const posts = new Set();
    let idle = 0;
    for (let round = 0; round < 200 && idle < 5 && candidates.length - initialCount < perSourceLimit && Date.now() < until; round++) {
      const data = await io.inspect(mode);
      if (data.error) { skipped.push(`${source.url}: ${data.error}`); break; }
      const size = seenRows.size + posts.size;
      for (const row of data.profiles || []) seenRows.add(row.url);
      for (const post of data.posts || []) posts.add(post);
      mergeCandidates(candidates, data.profiles || [], source, Math.min(limit, initialCount + perSourceLimit));
      idle = !data.loading && !data.waiting && size === seenRows.size + posts.size ? idle + 1 : 0;
      if (round % 8 === 0) await progress(candidates.length);
      // Discovery feeds stop after enough posts; each author is inspected below.
      if (mode === "posts" && posts.size >= perSourceLimit) break;
      await io.pause();
    }
    if (mode === "posts") {
      for (const post of posts) {
        if (candidates.length - initialCount >= perSourceLimit || Date.now() >= until) break;
        await io.navigate(post);
        const data = await io.inspect("authors");
        if (data.error) skipped.push(`${post}: ${data.error}`);
        else mergeCandidates(candidates, data.profiles || [], { ...source, url: post }, Math.min(limit, initialCount + perSourceLimit));
        await progress(candidates.length);
      }
    }
    if (!seenRows.size && !posts.size) skipped.push(`${source.url}: Instagram no ha mostrado perfiles accesibles.`);
  }
  if (Date.now() >= until) skipped.push("Recopilacion parcial: se ha alcanzado el tiempo de consulta de fuentes.");
  if (!candidates.length) throw new Error(skipped.join("\n") || "Instagram no ha mostrado perfiles en estas fuentes.");
  return { candidates, skipped };
}
