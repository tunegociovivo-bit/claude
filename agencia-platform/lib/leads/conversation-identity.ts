type ConversationDb = {
  leadInboxMessage: { findMany(args: any): Promise<any[]> };
  leadConversationMeta: { findMany(args: any): Promise<any[]> };
};

/**
 * Resuelve todos los identificadores que pertenecen al mismo contacto de
 * WhatsApp. Una conversación puede empezar con un número real y continuar con
 * un LID (o al revés); el leadId y LeadConversationMeta forman el puente.
 */
export async function resolveConversationIdentity(
  db: ConversationDb,
  workspaceId: string,
  phone: string,
  explicitLeadId?: string | null
): Promise<{ phones: string[]; leadIds: string[] }> {
  const phones = new Set<string>([phone]);
  const leadIds = new Set<string>();
  if (explicitLeadId) leadIds.add(explicitLeadId);

  const addMessage = (m: any) => {
    if (m.phoneNormalized) phones.add(String(m.phoneNormalized));
    if (m.fromPhone) phones.add(String(m.fromPhone));
    if (m.leadId) leadIds.add(String(m.leadId));
  };
  const addMeta = (m: any) => {
    if (m.phone) phones.add(String(m.phone));
    if (m.realPhone) phones.add(String(m.realPhone));
  };

  const seed = await db.leadInboxMessage.findMany({
    where: { workspaceId, OR: [{ phoneNormalized: phone }, { fromPhone: phone }] },
    select: { phoneNormalized: true, fromPhone: true, leadId: true }
  });
  seed.forEach(addMessage);

  if (leadIds.size) {
    const linked = await db.leadInboxMessage.findMany({
      where: { workspaceId, leadId: { in: [...leadIds] } },
      select: { phoneNormalized: true, fromPhone: true, leadId: true }
    });
    linked.forEach(addMessage);
  }

  const aliases = [...phones];
  const metas = await db.leadConversationMeta.findMany({
    where: { workspaceId, OR: [{ phone: { in: aliases } }, { realPhone: { in: aliases } }] },
    select: { phone: true, realPhone: true }
  });
  metas.forEach(addMeta);

  return { phones: [...phones], leadIds: [...leadIds] };
}

export function conversationWhere(workspaceId: string, phones: string[], leadIds: string[]) {
  const OR: any[] = [{ phoneNormalized: { in: phones } }, { fromPhone: { in: phones } }];
  if (leadIds.length) OR.push({ leadId: { in: leadIds } });
  return { workspaceId, OR };
}

/**
 * Identificadores con los que se GUARDA una respuesta SALIENTE para que quede en el mismo
 * hilo que el último entrante:
 *  - `fromPhone`: el alias CRUDO del hilo vivo (puede llevar sufijo @c.us/@lid).
 *  - `phoneNormalized`: el número NORMALIZADO del hilo vivo — NUNCA el alias con sufijo
 *    (guardar `fromPhone` aquí contaminaría la columna normalizada). Cae al teléfono de
 *    entrada si el entrante no traía normalizado.
 */
export function outgoingReplyIdentity(
  lastIn: { fromPhone?: string | null; phoneNormalized?: string | null },
  fallbackPhone: string
): { fromPhone: string; phoneNormalized: string } {
  return {
    fromPhone: lastIn.fromPhone || fallbackPhone,
    phoneNormalized: lastIn.phoneNormalized || fallbackPhone
  };
}
