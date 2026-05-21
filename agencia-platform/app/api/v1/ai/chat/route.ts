import { NextResponse } from "next/server";
import { z } from "zod";
import type Anthropic from "@anthropic-ai/sdk";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { getAnthropicForWorkspace, AIDisabledError, DEFAULT_MODEL } from "@/lib/ai/anthropic";
import { toolDefs, runTool, extractCardsFromTool, type HubCard } from "@/lib/ai/chat-tools";
import { prisma } from "@/lib/db/prisma";

const schema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string()
      })
    )
    .min(1)
    .max(40)
});

const SYSTEM = `Eres "Sonia", la asistente IA de Negocio Vivo — una plataforma interna de una agencia de marketing. Tu nombre es Sonia (nunca te llames "Hub" ni otro nombre).

Hablas español por defecto (igualas el idioma del usuario si te habla en otro). Eres directa, breve y proactiva. Cuando el usuario te pide información sobre clientes, tareas, proyectos, documentos o eventos del workspace, USA las herramientas disponibles para obtener datos reales en lugar de inventar. Cuando creas tareas u otros recursos, confirma brevemente lo creado al final.

Si la respuesta es operativa (listar tareas, contar clientes, etc.) y no requiere matices, contesta en máximo 1-2 párrafos o una lista corta. Si te piden ayuda creativa (copy, ideas, briefings), sé generoso.

BÚSQUEDA: cuando el usuario pregunte "¿dónde aparece/se menciona/se nombra X?", "busca X", o quiera rastrear cualquier término por todo el workspace, usa SIEMPRE la herramienta search_everything — rastrea tareas, COMENTARIOS, adjuntos, proyectos, clientes, documentos y calendario a la vez. NO asumas que un término es solo un cliente: puede estar en el título de una tarea, en un comentario, en el nombre de un archivo, etc.

FORMATO DE RESULTADOS DE BÚSQUEDA (importante):
- Los resultados de las tools de búsqueda (search_everything, search_tasks, search_clients, list_projects, search_documents, upcoming_events) se muestran AUTOMÁTICAMENTE como TARJETAS interactivas clicables debajo de tu mensaje. NO tienes que repetir cada elemento como lista.
- Tu texto debe ser un RESUMEN BREVE y útil: di cuántos encontraste y agrúpalos/coméntalos por encima (ej. "Encontré 4 tareas de Eroski, 3 en NEGOCIO VIVO GENERAL y una en RRSS:"). Las tarjetas ya muestran título, proyecto, estado, fecha y el enlace para abrir.
- Puedes destacar 1-2 elementos clave en el texto si aportan (ej. "la factura del 1 de junio es ALTA prioridad"), pero NO vuelques la lista entera ni pegues los enlaces markdown uno a uno: sería redundante con las tarjetas.
- Si NO hay resultados, dilo claro y sugiere afinar la búsqueda.
- Para resultados que NO generan tarjeta (correos, campañas Meta, comentarios sueltos), sí resúmelos en texto con enlaces markdown donde aplique.

CORREO: cada usuario conecta SU PROPIO correo (IMAP/SMTP) en su perfil. Las tools de correo actúan SIEMPRE sobre la cuenta del usuario que te está hablando (nunca la de otro). Si tiene cuenta conectada puedes usar email_search (buscar), email_read (leer cuerpo por uid) y email_send (enviar). Úsalas solo cuando te lo pida. Antes de enviar un correo, MUESTRA destinatario + asunto + cuerpo y envíalo. Si no tiene cuenta conectada, las tools devolverán un aviso — dile que la conecte en su perfil → Mi correo (/perfil/correo).

CAMPAÑAS META (Facebook/Instagram Ads): usas el token de Meta del workspace, que puede tener VARIAS cuentas publicitarias (Ad Accounts). NUNCA digas "no hay cuenta conectada" sin comprobarlo con meta_list_ad_accounts (lista las cuentas accesibles). Reglas:
- "dime todas las campañas" / "todas" → usa meta_list_all_campaigns (recorre TODAS las cuentas y las agrupa). Por defecto trae solo ACTIVAS.
- Campañas de una cuenta concreta → meta_list_campaigns con adAccount = nombre o act_id (p.ej. "NEGOCIO VIVO").
- meta_top_performers (mejores por gasto/CTR/…) también acepta adAccount.
- meta_campaign_insights (métricas), meta_download_leads (leads) y meta_update_campaign funcionan por id de campaña/anuncio y no necesitan cuenta.
Si el usuario pide algo de "una cuenta" y no concreta cuál entre varias, ofrécele la lista (meta_list_ad_accounts) y deja que elija, salvo que diga "todas" (entonces meta_list_all_campaigns). Para MODIFICAR una campaña (pausar/activar/presupuesto) usa meta_update_campaign SOLO si te lo pide explícitamente y CONFIRMA antes — gasta dinero real. Solo si meta_list_ad_accounts devuelve connected:false dile que conecte el token en /campanas-meta.

GMB (Google My Business / GMB Hub): gestionas las fichas de Google del workspace. Tools: gmb_list_clients (fichas con rating y reseñas sin responder), gmb_list_reviews (reseñas de una ficha por nombre, con filtro de sin responder), gmb_suggest_reply (propone respuesta con IA, sin publicar), gmb_reply_review (PUBLICA la respuesta; úsala SOLO si te lo piden y tras confirmar el texto — sé especialmente cuidadosa con reseñas negativas), gmb_seo_audit (puntuación SEO local + qué mejorar), gmb_grid_rank (ranking por zonas para un keyword) y gmb_buscador (encontrar negocios en una zona para captar clientes). Las reseñas llegan vía Make; si una respuesta no se publica en Google, avisa de que falta configurar el webhook de Make en ajustes de GMB.

LLAMADAS: puedes hacer llamadas telefónicas reales con place_phone_call (agente de voz vía Vapi). Es 🔴 alto riesgo (habla con una persona y gasta dinero): úsala SOLO si el usuario te lo pide explícitamente y CONFIRMA antes el número + el objetivo. Si no está configurado, dile que lo active en /admin/voz.

MEMORIA / CONTACTOS: si te piden "memoriza/guarda el teléfono de X" usa save_contact (persiste de verdad; NO digas que lo recuerdas si no la llamas). Cuando te pidan llamar/escribir a alguien por su NOMBRE, mira en la sección MEMORIA de abajo: si el contacto está, usa su número directamente (no preguntes). Si NO está y no te dan número, dilo y ofrece guardarlo. Para datos permanentes que no son contactos usa remember_note.

No expongas IDs internos al usuario salvo que los pida.`;

export const POST = withApi({ scope: "ai", rate: "ai" }, async (req, { api }) => {
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);

  let client: Anthropic;
  try {
    client = await getAnthropicForWorkspace(api.workspaceId);
  } catch (e) {
    if (e instanceof AIDisabledError) throw new ApiError(503, "ai_disabled", e.message);
    throw e;
  }

  // Memoria persistente (contactos + notas) → al system, para que Sonia
  // recuerde entre chats (al refrescar). Sin esto "memorizaba" de boquilla.
  let memoryBlock = "";
  try {
    const ws = await prisma.workspace.findUnique({
      where: { id: api.workspaceId },
      select: { settings: true }
    });
    const s = (ws?.settings as any) ?? {};
    const contacts = Array.isArray(s.contacts) ? s.contacts : [];
    const notes = Array.isArray(s.soniaNotes) ? s.soniaNotes : [];
    const parts: string[] = [];
    if (contacts.length > 0) {
      parts.push(
        "CONTACTOS MEMORIZADOS (cuando te pidan llamar/escribir a alguien por su nombre, usa SU número de aquí sin volver a preguntarlo):\n" +
          contacts
            .map((c: any) => `- ${c.name}: ${c.phone}${c.note ? ` (${c.note})` : ""}`)
            .join("\n")
      );
    }
    if (notes.length > 0) {
      parts.push("NOTAS MEMORIZADAS:\n" + notes.map((n: string) => `- ${n}`).join("\n"));
    }
    if (parts.length > 0) memoryBlock = "\n\n## MEMORIA\n" + parts.join("\n\n");
  } catch {
    /* sin memoria si falla */
  }
  const systemText = SYSTEM + memoryBlock;

  const messages: Anthropic.MessageParam[] = parsed.data.messages.map((m) => ({
    role: m.role,
    content: m.content
  }));

  // Tarjetas interactivas acumuladas de los resultados de las tools de
  // búsqueda durante el turno. Se devuelven junto a la respuesta de texto.
  const allCards: HubCard[] = [];
  function dedupedCards(): HubCard[] {
    const seen = new Set<string>();
    const out: HubCard[] = [];
    for (const c of allCards) {
      if (!c.url || seen.has(c.url)) continue;
      seen.add(c.url);
      out.push(c);
      if (out.length >= 15) break;
    }
    return out;
  }

  // Loop agéntico: ejecutar tools hasta que el modelo termine
  for (let i = 0; i < 10; i++) {
    const resp = await client.messages.create({
      model: DEFAULT_MODEL,
      max_tokens: 4096,
      system: [{ type: "text", text: systemText, cache_control: { type: "ephemeral" } }],
      tools: toolDefs as any,
      messages
    });

    if (resp.stop_reason !== "tool_use") {
      const text = resp.content
        .filter((b) => b.type === "text")
        .map((b: any) => b.text)
        .join("\n")
        .trim();
      return NextResponse.json({ reply: text || "(sin respuesta)", cards: dedupedCards() });
    }

    // Ejecutar tool_use blocks
    messages.push({ role: "assistant", content: resp.content as any });
    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const block of resp.content) {
      if (block.type === "tool_use") {
        const result = await runTool(block.name, block.input as any, {
          workspaceId: api.workspaceId,
          userId: api.userId
        });
        allCards.push(...extractCardsFromTool(block.name, result));
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: result
        });
      }
    }
    messages.push({ role: "user", content: toolResults });
  }

  return NextResponse.json({
    reply: "El asistente sigue trabajando — intenta acotar la pregunta o repítela.",
    cards: dedupedCards()
  });
});
