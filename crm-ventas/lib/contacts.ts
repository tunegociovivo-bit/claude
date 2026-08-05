import { prisma } from "@/lib/prisma";
import { last9 } from "@/lib/phone";

// Busca un contacto por teléfono (tolerante a prefijos) o lo crea.
export async function findOrCreateContactByPhone(opts: {
  workspaceId: string;
  phone: string; // normalizado (o chatId @lid)
  name?: string;
  source: "whatsapp" | "llamada" | "manual";
}) {
  const { workspaceId, phone } = opts;
  const isChatId = phone.includes("@");
  const suffix = isChatId ? phone : last9(phone);

  let contact = await prisma.contact.findFirst({
    where: {
      workspaceId,
      phone: isChatId ? phone : { endsWith: suffix },
    },
    orderBy: { createdAt: "asc" },
  });

  if (!contact) {
    contact = await prisma.contact.create({
      data: {
        workspaceId,
        name: opts.name?.trim() || phone,
        phone,
        stage: "nuevos",
        source: opts.source,
      },
    });
  } else if (opts.name && (contact.name === contact.phone || !contact.name)) {
    // Mejora el nombre placeholder cuando lo aprendemos (pushName, cita, etc.)
    contact = await prisma.contact.update({
      where: { id: contact.id },
      data: { name: opts.name.trim() },
    });
  }
  return contact;
}

export async function moveContactToStage(contactId: string, stage: string) {
  const first = await prisma.contact.findFirst({
    where: { id: contactId },
    select: { workspaceId: true },
  });
  if (!first) return;
  const min = await prisma.contact.aggregate({
    where: { workspaceId: first.workspaceId, stage },
    _min: { order: true },
  });
  await prisma.contact.update({
    where: { id: contactId },
    data: { stage, order: (min._min.order ?? 0) - 1 },
  });
}
