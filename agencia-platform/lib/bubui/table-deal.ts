/**
 * Motor de la Mesa Colectiva de Bubui.
 *
 * Calcula el descuento de una mesa según su estado: base por nº de comensales,
 * + bonus si TODOS comparten (con N amigos nuevos), + bonus si TODOS dejan
 * reseña en Google (vía el enlace; no se condiciona a que sea positiva).
 * Lógica pura, sin IO, fácil de testear.
 */

export type MesaConfig = {
  basePct: number;
  minDiners: number;
  shareBonusPct: number;
  shareFriends: number;
  reviewBonusPct: number;
  maxPct: number;
  /** true = los bonus (compartir/reseña) se aplican a ESTA cuenta; false (def)
   *  = se guardan como cupón de PRÓXIMA visita (recurrencia). */
  bonusOnThisVisit?: boolean;
  /** Si true, un comensal que YA tenía la app (veterano) debe completar una
   *  acción de aporte para que su parte cuente (el nuevo aporta instalándose).
   *  Evita regalar descuento sin recibir valor neto-nuevo cuando la zona ya
   *  está saturada de usuarios. */
  veteranMustContribute?: boolean;
  /** Plataforma de reseña que pide el negocio (Google/Tripadvisor/…) para los
   *  textos del checklist. */
  reviewPlatformLabel?: string;
};

export type MesaParticipant = {
  /** Se instaló la app al unirse a esta mesa (su instalación ya es el aporte). */
  isNewUser: boolean;
  /** Veterano que completó una acción del menú (compartir/reseña/foto/seguir). */
  contributed: boolean;
  sharedCount: number;
  sharedDone: boolean;
  reviewDone: boolean;
};

export type MesaStep = {
  key: "quorum" | "share" | "review";
  label: string;
  pct: number;
  euros: number; // cuánto suma este paso sobre el ticket
  done: boolean;
};

export type MesaState = {
  /** Descuento aplicable AHORA mismo (in situ). */
  pctNow: number;
  /** Descuento de PRÓXIMA visita (cupón diferido). */
  pctNextVisit: number;
  /** Máximo alcanzable si completan TODO (el gancho a mostrar). */
  maxPotentialPct: number;
  diners: number;
  quorum: boolean;
  /** Todos han aportado valor neto-nuevo (nuevos por instalar, veteranos por
   *  su acción). Si false, el descuento base está BLOQUEADO. */
  everyonePaidEntry: boolean;
  /** Cuántos veteranos faltan por aportar (para el aviso "falta que X aporte"). */
  pendingContributors: number;
  everyoneShared: boolean;
  everyoneReviewed: boolean;
  steps: MesaStep[];
  /** Cifras en € si se pasa el importe del ticket (null si no). */
  euros: {
    ticket: number;
    savedNow: number; // ahorro aplicado ya
    savedNextVisit: number; // ahorro en cupón próxima visita
    maxSaving: number; // ahorro máximo posible (gancho)
    payNow: number; // lo que pagan ahora
    leftOnTable: number; // € que se dejan sin conseguir todavía
  } | null;
};

function clampPct(v: number, max: number): number {
  return Math.max(0, Math.min(max, Math.round(v)));
}
function eur(ticket: number, pct: number): number {
  return Math.round(ticket * pct) / 100;
}

/**
 * Estado de descuento de la mesa, anclado en EUROS sobre el ticket escaneado.
 * Base = se aplica en el local con quórum. Bonus (compartir/reseña) = en esta
 * cuenta o en cupón de próxima visita según cfg.bonusOnThisVisit. Devuelve
 * además el máximo potencial y el checklist con € por paso (para el indicador
 * "te ahorras 60€" y la aversión a la pérdida "te dejas 20€").
 */
export function computeMesa(
  cfg: MesaConfig,
  participants: MesaParticipant[],
  ticketAmount?: number | null
): MesaState {
  const diners = participants.length;
  const quorum = diners >= Math.max(1, cfg.minDiners);
  const everyoneShared = diners > 0 && participants.every((p) => p.sharedDone || p.sharedCount >= cfg.shareFriends);
  const everyoneReviewed = diners > 0 && participants.every((p) => p.reviewDone);

  // Valor neto-nuevo: el nuevo aporta instalándose; el veterano, con su acción.
  // Si veteranMustContribute=false, todos cuentan por estar presentes.
  const paidEntry = (p: MesaParticipant) => p.isNewUser || !cfg.veteranMustContribute || p.contributed;
  const everyonePaidEntry = diners > 0 && participants.every(paidEntry);
  const pendingContributors = participants.filter((p) => !paidEntry(p)).length;

  // El descuento base solo se DESBLOQUEA si hay quórum Y todos han aportado.
  const basePct = quorum && everyonePaidEntry ? cfg.basePct : 0;
  const sharePct = everyoneShared ? cfg.shareBonusPct : 0;
  const reviewPct = everyoneReviewed ? cfg.reviewBonusPct : 0;

  // Reparto entre esta visita y la próxima, respetando el tope global.
  let pctNow = clampPct(basePct, cfg.maxPct);
  let pctNextVisit = 0;
  if (cfg.bonusOnThisVisit) {
    pctNow = clampPct(basePct + sharePct + reviewPct, cfg.maxPct);
  } else {
    pctNextVisit = clampPct(sharePct + reviewPct, Math.max(0, cfg.maxPct - pctNow));
  }
  // Máximo alcanzable si lo completan todo (gancho del indicador).
  const maxPotentialPct = clampPct(cfg.basePct + cfg.shareBonusPct + cfg.reviewBonusPct, cfg.maxPct);

  const allSteps: MesaStep[] = [
    {
      key: "quorum",
      label: !quorum
        ? `Sed ${cfg.minDiners}+ en la mesa`
        : !everyonePaidEntry
          ? `Falta que ${pendingContributors} aporte${pendingContributors === 1 ? "" : "n"} (compartir/reseña/foto)`
          : `Sois ${diners} y todos habéis aportado`,
      pct: cfg.basePct,
      euros: ticketAmount ? eur(ticketAmount, cfg.basePct) : 0,
      done: quorum && everyonePaidEntry
    },
    {
      key: "share",
      label: `Todos compartís Bubui (${cfg.shareFriends} amigos c/u)`,
      pct: cfg.shareBonusPct,
      euros: ticketAmount ? eur(ticketAmount, cfg.shareBonusPct) : 0,
      done: everyoneShared
    },
    {
      key: "review",
      label: `Todos dejáis reseña en ${cfg.reviewPlatformLabel || "Google"}`,
      pct: cfg.reviewBonusPct,
      euros: ticketAmount ? eur(ticketAmount, cfg.reviewBonusPct) : 0,
      done: everyoneReviewed
    }
  ];
  const steps = allSteps.filter((s) => s.pct > 0);

  let euros: MesaState["euros"] = null;
  if (ticketAmount && ticketAmount > 0) {
    const savedNow = eur(ticketAmount, pctNow);
    const savedNextVisit = eur(ticketAmount, pctNextVisit);
    const maxSaving = eur(ticketAmount, maxPotentialPct);
    euros = {
      ticket: ticketAmount,
      savedNow,
      savedNextVisit,
      maxSaving,
      payNow: Math.round((ticketAmount - savedNow) * 100) / 100,
      leftOnTable: Math.max(0, Math.round((maxSaving - savedNow - savedNextVisit) * 100) / 100)
    };
  }

  return { pctNow, pctNextVisit, maxPotentialPct, diners, quorum, everyonePaidEntry, pendingContributors, everyoneShared, everyoneReviewed, steps, euros };
}

/**
 * Auto-ajuste por saturación: cuanto mayor es la proporción de VETERANOS en la
 * mesa (zona ya penetrada), más amigos se exige a cada veterano. Cuando casi
 * todos son nuevos, no aprieta (queremos instalaciones). Se usa al crear la
 * sesión para fijar el umbral efectivo.
 */
export function effectiveVeteranShareFriends(base: number, veteranRatio: number): number {
  if (veteranRatio >= 0.8) return base + 2;
  if (veteranRatio >= 0.5) return base + 1;
  return base;
}

/** Código corto legible para unirse a la mesa (sin caracteres ambiguos). */
export function genTableCode(): string {
  const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sin O/0/I/1
  let s = "";
  for (let i = 0; i < 5; i++) s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return s;
}
