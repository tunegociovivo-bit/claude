/**
 * Motor de la Mesa Colectiva de Bubui.
 *
 * El descuento de la mesa se desbloquea cuando el grupo completa un BOTE COMÚN
 * de acciones VERIFICADAS: N acciones para N comensales. Una acción verificada
 * es una captura validada por IA — una reseña en Google/{plataforma} o una
 * publicación en redes etiquetando al restaurante. Es un bote: cualquier
 * comensal puede hacer hasta 2 acciones (reseña + publicación) para cubrir a
 * quien no puede/quiere, de modo que la mesa no se quede sin descuento.
 *
 * Compartir el enlace (invitar amigos) NO cuenta para este descuento: su premio
 * es la hucha de próxima visita por cada amigo que se da de alta. Lógica pura.
 */

export type MesaConfig = {
  basePct: number;
  minDiners: number;
  shareBonusPct: number;
  shareFriends: number;
  reviewBonusPct: number;
  maxPct: number;
  /** Conservados por compatibilidad con la config del negocio (no se usan en el
   *  modelo de bote común; el descuento es basePct al completar las N acciones). */
  bonusOnThisVisit?: boolean;
  veteranMustContribute?: boolean;
  newUserMustContribute?: boolean;
  /** Plataforma de reseña que pide el negocio (Google/Tripadvisor/…) para los
   *  textos del checklist. */
  reviewPlatformLabel?: string;
};

export type MesaParticipant = {
  /** Se instaló la app al unirse a esta mesa. */
  isNewUser: boolean;
  /** Subió captura de reseña validada por IA (cuenta 1 acción del bote). */
  reviewVerified: boolean;
  /** Subió captura de publicación social validada por IA (cuenta 1 acción). */
  socialVerified: boolean;
  /** Reseña aceptada provisional (la IA no pudo validar; revisar camarero). */
  reviewProvisional: boolean;
  /** Publicación aceptada provisional (la IA no pudo validar; revisar camarero). */
  socialProvisional: boolean;
  // Legacy (acciones por clic, ya no desbloquean; se mantienen para registro).
  contributed: boolean;
  sharedCount: number;
  sharedDone: boolean;
  reviewDone: boolean;
};

export type MesaStep = {
  key: "quorum" | "actions";
  label: string;
  pct: number;
  euros: number; // cuánto suma este paso sobre el ticket
  done: boolean;
};

export type MesaState = {
  /** Descuento aplicable AHORA mismo (in situ). */
  pctNow: number;
  /** Descuento de PRÓXIMA visita (cupón diferido). Siempre 0 en este modelo. */
  pctNextVisit: number;
  /** Máximo alcanzable si completan el bote (el gancho a mostrar). */
  maxPotentialPct: number;
  diners: number;
  quorum: boolean;
  /** Acciones verificadas que necesita la mesa (= nº de comensales). */
  requiredActions: number;
  /** Acciones verificadas conseguidas por el grupo (bote común). */
  verifiedActions: number;
  /** Acciones que faltan para desbloquear el descuento. */
  actionsRemaining: number;
  /** Acciones aceptadas PROVISIONALMENTE (la IA no validó): el camarero debe
   *  verificarlas a mano antes de aplicar el descuento. */
  provisionalActions: number;
  /** El descuento está desbloqueado (quórum + bote completo). */
  unlocked: boolean;
  // Campos legacy mantenidos para compatibilidad con consumidores existentes.
  everyonePaidEntry: boolean;
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

/** Acciones verificadas que aporta un comensal al bote (0, 1 o 2). */
function actionsOf(p: MesaParticipant): number {
  return (p.reviewVerified ? 1 : 0) + (p.socialVerified ? 1 : 0);
}

/**
 * Estado de descuento de la mesa (modelo de bote común), anclado en EUROS sobre
 * el ticket. El descuento (basePct) se desbloquea con quórum + N acciones
 * verificadas (N = comensales), repartibles libremente entre la mesa.
 */
export function computeMesa(
  cfg: MesaConfig,
  participants: MesaParticipant[],
  ticketAmount?: number | null
): MesaState {
  const diners = participants.length;
  const quorum = diners >= Math.max(1, cfg.minDiners);

  // Bote común: N acciones verificadas para N comensales. Las aporta quien sea.
  const requiredActions = diners;
  const verifiedActions = participants.reduce((n, p) => n + actionsOf(p), 0);
  const provisionalActions = participants.reduce(
    (n, p) => n + (p.reviewVerified && p.reviewProvisional ? 1 : 0) + (p.socialVerified && p.socialProvisional ? 1 : 0),
    0
  );
  const actionsRemaining = Math.max(0, requiredActions - verifiedActions);
  const botDone = diners > 0 && verifiedActions >= requiredActions;
  const unlocked = quorum && botDone;

  const everyoneReviewed = diners > 0 && participants.every((p) => p.reviewVerified);

  const pctNow = unlocked ? clampPct(cfg.basePct, cfg.maxPct) : 0;
  const pctNextVisit = 0;
  const maxPotentialPct = clampPct(cfg.basePct, cfg.maxPct);

  const steps: MesaStep[] = [
    {
      key: "quorum",
      label: quorum ? `Sois ${diners} en la mesa` : `Sed ${cfg.minDiners}+ en la mesa`,
      pct: 0,
      euros: 0,
      done: quorum
    },
    {
      key: "actions",
      label: botDone
        ? `¡Bote completo! ${verifiedActions}/${requiredActions} acciones`
        : `Acciones de la mesa: ${verifiedActions}/${requiredActions} (faltan ${actionsRemaining})`,
      pct: cfg.basePct,
      euros: ticketAmount ? eur(ticketAmount, cfg.basePct) : 0,
      done: botDone
    }
  ];

  let euros: MesaState["euros"] = null;
  if (ticketAmount && ticketAmount > 0) {
    const savedNow = eur(ticketAmount, pctNow);
    const maxSaving = eur(ticketAmount, maxPotentialPct);
    euros = {
      ticket: ticketAmount,
      savedNow,
      savedNextVisit: 0,
      maxSaving,
      payNow: Math.round((ticketAmount - savedNow) * 100) / 100,
      leftOnTable: Math.max(0, Math.round((maxSaving - savedNow) * 100) / 100)
    };
  }

  return {
    pctNow,
    pctNextVisit,
    maxPotentialPct,
    diners,
    quorum,
    requiredActions,
    verifiedActions,
    actionsRemaining,
    provisionalActions,
    unlocked,
    // Legacy (derivados del nuevo modelo).
    everyonePaidEntry: unlocked,
    pendingContributors: actionsRemaining,
    everyoneShared: false,
    everyoneReviewed,
    steps,
    euros
  };
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
