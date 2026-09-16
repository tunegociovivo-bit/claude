import { parseAndroidUiNodes, type AndroidUiPoint } from "@/components/mobile/android-ui-hierarchy";
import { facebookNodes, findExactComment, joinedGroupRows, namedControl, nodeText, screenSignature, visibleComments, visiblePostComments, type NativeComment } from "@/components/mobile/facebook-conversation-ui";
import { conversationFingerprint, normalizeFacebookText, type FacebookConversationBatch, type ConversationReply } from "@/lib/mobile/facebook-conversations";

export type ConversationRunnerDependencies = {
  read: () => Promise<string>;
  tap: (point: AndroidUiPoint) => Promise<void>;
  scroll: (xml: string, direction: "up" | "down") => Promise<void>;
  back: () => Promise<void>;
  openUrl: (url: string) => Promise<void>;
  paste: (text: string) => Promise<void>;
  wait: (ms: number) => Promise<void>;
  checkpoint: (batch: FacebookConversationBatch) => Promise<void>;
  filterGroups: (names: string[], niche: string) => Promise<string[]>;
  analyze: (comments: NativeComment[], groupName: string) => Promise<Array<{ id: string; reply: string; reason: string }>>;
};

async function openJoinedList(deps: ConversationRunnerDependencies) {
  const current = await deps.read();
  if (namedControl(current, /^Buscar tus grupos por nombre$|^Search your groups$/i)) return current;
  await deps.openUrl("https://www.facebook.com/groups/?category=membership");
  for (let attempt = 0; attempt < 12; attempt++) {
    const xml = await deps.read();
    if (namedControl(xml, /^Buscar tus grupos por nombre$|^Search your groups$/i) || joinedGroupRows(xml).length >= 4) return xml;
    const nodes = facebookNodes(xml);
    const tab = nodes.find((node) => /^Tus grupos[, ]|^Your groups[, ]/i.test(nodeText(node)) && /Tab/.test(node.className));
    const all = namedControl(xml, /^Ver todo$|^See all$/i);
    const groups = nodes.find((node) => /^Grupos(?:,|$)|^Groups(?:,|$)/i.test(nodeText(node)) && (node.clickable || /Tab/.test(node.className)));
    if (tab) await deps.tap(tab.center);
    else if (all && namedControl(xml, /^Tus grupos$|^Your groups$/i)) await deps.tap(all.center);
    else if (groups) await deps.tap(groups.center);
    else if (attempt === 1 || attempt === 4) await deps.scroll(xml, "up");
    else await deps.back();
    await deps.wait(700);
  }
  throw new Error("Facebook no ha mostrado la lista «Tus grupos». Abre esa lista en el móvil y reintenta.");
}

async function inventory(deps: ConversationRunnerDependencies) {
  let xml = await openJoinedList(deps);
  for (let page = 0; page < 200; page++) {
    const before = screenSignature(xml);
    await deps.scroll(xml, "up");
    xml = await deps.read();
    if (screenSignature(xml) === before) break;
  }
  const groups = new Map<string, { name: string; details: string }>();
  let previous = "";
  let stable = 0;
  for (let page = 0; page < 200; page++) {
    joinedGroupRows(xml).forEach((row) => groups.set(`${row.name}|${row.details}`, { name: row.name, details: row.details }));
    const signature = screenSignature(xml);
    stable = signature === previous ? stable + 1 : 0;
    if (stable >= 2) return { groups: [...groups.values()], complete: true };
    if (groups.size >= 1000) break;
    previous = signature;
    await deps.scroll(xml, "down");
    await deps.wait(650);
    xml = await deps.read();
  }
  return { groups: [...groups.values()], complete: false };
}

async function openGroup(name: string, details: string | undefined, deps: ConversationRunnerDependencies) {
  let xml = await openJoinedList(deps);
  // Always start at the top; Facebook can preserve the previous list position.
  for (let i = 0; i < 200; i++) {
    const before = screenSignature(xml);
    await deps.scroll(xml, "up");
    xml = await deps.read();
    if (screenSignature(xml) === before) break;
  }
  let previous = "";
  for (let page = 0; page < 200; page++) {
    const matches = joinedGroupRows(xml).filter((row) => normalizeFacebookText(row.name) === normalizeFacebookText(name) && (!details || row.details === details));
    if (matches.length > 1) throw new Error("Hay varios grupos con el mismo nombre; hace falta un enlace concreto.");
    if (matches.length === 1) {
      await deps.tap(matches[0].point);
      await deps.wait(1000);
      const opened = await deps.read();
      if (!facebookNodes(opened).some((node) => normalizeFacebookText(nodeText(node)).includes(normalizeFacebookText(name)))) {
        throw new Error("No se ha podido confirmar el grupo abierto.");
      }
      return;
    }
    const signature = screenSignature(xml);
    if (signature === previous) break;
    previous = signature;
    await deps.scroll(xml, "down");
    xml = await deps.read();
  }
  throw new Error("Este grupo ya no aparece en «Tus grupos».");
}

async function allCommentsFilter(deps: ConversationRunnerDependencies) {
  let xml = await deps.read();
  const filter = namedControl(xml, /^Se muestran Más pertinentes|^Más pertinentes$|^Most relevant$/i);
  if (filter) {
    await deps.tap(filter.center);
    xml = await deps.read();
    const all = namedControl(xml, /^Todos los comentarios|^All comments/i);
    if (all) await deps.tap(all.center);
    else await deps.back();
  }
}

async function readThread(deps: ConversationRunnerDependencies, screens: number, consume: (comments: NativeComment[]) => Promise<void>) {
  await deps.wait(800);
  const initial = await deps.read();
  if (parseAndroidUiNodes(initial).some((node) => /inputmethod|keyboard/.test(node.packageName))) { await deps.back(); await deps.wait(400); }
  await allCommentsFilter(deps);
  let previous = "";
  for (let page = 0; page < screens; page++) {
    const xml = await deps.read();
    const signature = screenSignature(xml);
    if (signature === previous) break;
    previous = signature;
    await consume(visibleComments(xml));
    const more = namedControl(xml, /^Ver más comentarios|^Ver comentarios anteriores|^View more comments|^View previous comments/i);
    if (more) await deps.tap(more.center);
    else await deps.scroll(xml, "down");
  }
  await deps.back();
  await deps.wait(500);
}

export async function scanFacebookConversations(initial: FacebookConversationBatch, deps: ConversationRunnerDependencies) {
  const batch = structuredClone(initial);
  const save = async (progress: string) => { batch.progress = progress; await deps.checkpoint(batch); };
  if (!batch.groups.length) {
    await save("Leyendo los grupos de esta cuenta…");
    if (batch.config.targetUrl) {
      batch.groups = [{ name: "Destino indicado", status: "pending", detail: "" }];
      batch.inventoryComplete = true;
    } else {
      const found = await inventory(deps);
      batch.inventoryComplete = found.complete;
      if (!found.complete) batch.warnings.push("La lista de grupos no llegó al final; el alcance es parcial.");
      const selected = new Set(await deps.filterGroups(found.groups.map((group) => group.name), batch.config.niche));
      batch.groups = found.groups.map((group) => ({ ...group, status: selected.has(group.name) ? "pending" : "excluded", detail: "" }));
    }
    await save(`${batch.groups.filter((group) => group.status === "pending").length} grupos coinciden con el alcance.`);
  }
  const seen = new Set(batch.candidates.map((item) => item.id));
  for (const group of batch.groups) {
    if (group.status === "done" || group.status === "excluded") continue;
    try {
      await save(`Leyendo ${group.name}…`);
      if (batch.config.targetUrl) await deps.openUrl(batch.config.targetUrl);
      else await openGroup(group.name, batch.groups.filter((candidate) => normalizeFacebookText(candidate.name) === normalizeFacebookText(group.name)).length > 1 ? group.details : undefined, deps);
      const processed = new Set<string>();
      let previous = "";
      let checked = 0;
      for (let page = 0; page < batch.config.postsPerGroup * 6 && checked < batch.config.postsPerGroup; page++) {
        const xml = await deps.read();
        // A direct publication link may open its comments immediately.
        const directComments = visibleComments(xml);
        const posts = visiblePostComments(xml);
        const post = posts.find((item) => !processed.has(item.anchor));
        if (post || (batch.config.targetUrl && directComments.length && checked === 0)) {
          const anchor = post?.anchor ?? batch.config.targetUrl;
          processed.add(anchor);
          if (post) await deps.tap(post.point);
          await readThread(deps, batch.config.commentScreensPerPost, async (comments) => {
            const fresh = comments.filter((comment) => !seen.has(conversationFingerprint([group.name, group.details ?? "", anchor, comment.author, comment.text])));
            if (!fresh.length) return;
            const replies = await deps.analyze(fresh, group.name);
            for (const reply of replies) {
              const comment = fresh.find((item) => item.id === reply.id);
              if (!comment || batch.candidates.length >= 150) continue;
              const id = conversationFingerprint([group.name, group.details ?? "", anchor, comment.author, comment.text]);
              if (seen.has(id)) continue;
              seen.add(id);
              batch.candidates.push({ id, groupName: group.name, groupDetails: group.details, groupUrl: batch.config.targetUrl, postAnchor: anchor, author: comment.author,
                sourceText: comment.text, sourceLabel: comment.sourceLabel, reply: reply.reply, reason: reply.reason,
                selected: true, outcome: "pending", detail: "" });
            }
            await save(`${group.name}: ${batch.candidates.length} comentarios con respuesta preparada.`);
          });
          checked++;
          if (batch.candidates.length >= 150) {
            batch.warnings.push("Se alcanzaron 150 comentarios. Revisa este lote antes de iniciar otra búsqueda.");
            await save("Lectura parcial: límite de 150 comentarios alcanzado.");
            return batch;
          }
          continue;
        }
        const signature = screenSignature(xml);
        if (signature === previous) break;
        previous = signature;
        await deps.scroll(xml, "down");
      }
      group.status = "done";
      group.detail = `${checked} publicaciones revisadas. Lectura limitada a ${batch.config.commentScreensPerPost} pantallas por publicación.`;
    } catch (error) {
      group.status = "failed";
      group.detail = error instanceof Error ? error.message.slice(0, 500) : "No se pudo leer el grupo.";
    }
    await save(`${batch.groups.filter((item) => item.status === "done").length} grupos revisados · ${batch.candidates.length} comentarios encontrados.`);
  }
  await save(`Búsqueda terminada: ${batch.candidates.length} comentarios para revisar.`);
  return batch;
}

async function locateReply(item: ConversationReply, batch: FacebookConversationBatch, deps: ConversationRunnerDependencies) {
  if (item.groupUrl) await deps.openUrl(item.groupUrl);
  else await openGroup(item.groupName, batch.groups.filter((candidate) => normalizeFacebookText(candidate.name) === normalizeFacebookText(item.groupName)).length > 1 ? item.groupDetails : undefined, deps);
  let previous = "";
  for (let page = 0; page < batch.config.postsPerGroup * 8; page++) {
    const xml = await deps.read();
    const direct = item.groupUrl ? findExactComment(xml, item.author, item.sourceText) : null;
    if (direct) return direct;
    const post = visiblePostComments(xml).find((candidate) => candidate.anchor === item.postAnchor);
    if (post) {
      await deps.tap(post.point);
      await allCommentsFilter(deps);
      for (let screen = 0; screen < batch.config.commentScreensPerPost + 2; screen++) {
        const commentsXml = await deps.read();
        const target = findExactComment(commentsXml, item.author, item.sourceText);
        if (target) return target;
        await deps.scroll(commentsXml, "down");
      }
      throw new Error("El comentario original no aparece o ha cambiado. Revisa el destino manualmente.");
    }
    const signature = screenSignature(xml);
    if (signature === previous) break;
    previous = signature;
    await deps.scroll(xml, "down");
  }
  throw new Error("No se ha localizado la publicación original. No se ha enviado la respuesta.");
}

export async function sendFacebookConversationReplies(initial: FacebookConversationBatch, deps: ConversationRunnerDependencies) {
  const batch = structuredClone(initial);
  for (const item of batch.candidates) {
    if (!item.selected || !["pending", "failed"].includes(item.outcome)) continue;
    let sendAttempted = false;
    if (!item.reply.trim()) { item.outcome = "failed"; item.detail = "La respuesta está vacía."; await deps.checkpoint(batch); continue; }
    try {
      batch.progress = `Localizando el comentario de ${item.author} en ${item.groupName}…`;
      await deps.checkpoint(batch);
      const target = await locateReply(item, batch, deps);
      await deps.tap(target.point);
      let xml = await deps.read();
      const composer = facebookNodes(xml).find((node) => /EditText|AutoCompleteTextView/.test(node.className)
        && /respon|respu|reply/i.test(`${node.text} ${node.contentDescription}`));
      if (!composer) throw new Error("Facebook no ha abierto un campo de respuesta al comentario seleccionado.");
      await deps.tap(composer.center);
      await deps.paste(item.reply);
      xml = await deps.read();
      const filled = facebookNodes(xml).some((node) => /EditText|AutoCompleteTextView/.test(node.className) && node.text.includes(item.reply));
      const send = namedControl(xml, /^(Enviar|Publicar|Send|Post)( comentario| respuesta)?$/i);
      if (!filled || !send) throw new Error("No se ha podido verificar el texto o el botón de envío.");
      item.outcome = "sending";
      item.detail = "Envío iniciado. Si la conexión se interrumpe, revisa Facebook antes de volver a enviar.";
      await deps.checkpoint(batch);
      sendAttempted = true;
      await deps.tap(send.center);
      await deps.wait(1500);
      xml = await deps.read();
      const shown = facebookNodes(xml).some((node) => !/EditText|AutoCompleteTextView/.test(node.className) && nodeText(node).includes(item.reply));
      item.outcome = shown ? "sent" : "review";
      item.detail = shown ? "Respuesta visible en Facebook." : "Envío pulsado; confirmación pendiente. No se reenviará automáticamente.";
    } catch (error) {
      item.outcome = sendAttempted ? "review" : "failed";
      item.detail = (error instanceof Error ? error.message : "No se pudo responder.").slice(0, 500);
    }
    batch.progress = `${batch.candidates.filter((candidate) => candidate.outcome === "sent").length} respuestas enviadas.`;
    await deps.checkpoint(batch);
  }
  return batch;
}
