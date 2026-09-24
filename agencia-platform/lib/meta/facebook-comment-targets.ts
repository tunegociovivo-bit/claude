type Creative = {
  effective_object_story_id?: string | null;
  object_story_id?: string | null;
  object_story_spec?: { page_id?: string | null };
};

/** Keep both originals and generated stories: their comment threads can differ. */
export function facebookCommentTargets(creative: Creative, pageTokens: Map<string, string>) {
  const ids = [...new Set([creative.effective_object_story_id, creative.object_story_id].filter((id): id is string => Boolean(id)))];
  return ids.map((id) => {
    const ownerId = id.includes("_") ? id.split("_")[0] : creative.object_story_spec?.page_id ?? undefined;
    return { id: ownerId && !id.includes("_") ? `${ownerId}_${id}` : id, ownerId, platform: "facebook" as const, token: ownerId ? pageTokens.get(ownerId) : undefined };
  });
}

/** Only parse identifiers; never fetch URLs supplied in this input. */
export function parseMetaImportReferences(value: string) {
  const extraAdIds = new Set<string>();
  const extraPosts: Array<{ adId: string; postId: string }> = [];
  for (const entry of value.split(/[\s,;]+/).filter(Boolean)) {
    if (/^\d+$/.test(entry)) { extraAdIds.add(entry); continue; }
    let url: URL;
    try { url = new URL(entry); } catch { throw new Error("Introduce un ID de anuncio o el enlace de su publicación de Facebook."); }
    if (url.protocol !== "https:" || !["facebook.com", "www.facebook.com", "m.facebook.com"].includes(url.hostname)) {
      throw new Error("El enlace debe ser una publicación de Facebook.");
    }
    const adId = url.searchParams.get("dco_ad_id");
    const postId = url.pathname.match(/\/posts\/(\d+)/)?.[1] ?? url.searchParams.get("story_fbid");
    if (!adId || !/^\d+$/.test(adId) || !postId || !/^\d+$/.test(postId)) {
      throw new Error("El enlace debe incluir la publicación y dco_ad_id. Copia el enlace de «Publicación de Facebook con comentarios» del anuncio.");
    }
    extraAdIds.add(adId);
    if (!extraPosts.some((post) => post.adId === adId && post.postId === postId)) extraPosts.push({ adId, postId });
  }
  if (extraAdIds.size > 50) throw new Error("Puedes consultar hasta 50 anuncios por importación.");
  return { extraAdIds: [...extraAdIds], extraPosts };
}
