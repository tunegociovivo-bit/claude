/**
 * Lead scorer híbrido (reglas + heurística, sin IA). Migra NVL_Lead_Scorer
 * del plugin. Score 0-100, urgencia categorizada.
 *
 * El punto dulce: rating bajo, pocos reviews, sin web, posición 4-15
 * (cerca del podio pero no #1).
 */

export type ScoreInput = {
  businessStatus?: string | null;
  rating?: number | null;
  reviewsCount?: number | null;
  negativePct?: number | null;
  position?: number | null;
  website?: string | null;
  competitorTopRating?: number | null; // rating del competidor #1
};

export type ScoreBreakdownItem = { signal: string; pts: number; note: string };

export type ScoreResult = {
  score: number;
  urgency: "critica" | "alta" | "media" | "baja" | "descartar";
  breakdown: ScoreBreakdownItem[];
};

export function scoreLead(lead: ScoreInput): ScoreResult {
  // Cerrado → 0 y descartar
  if (
    lead.businessStatus &&
    /CLOSED/.test(lead.businessStatus.toUpperCase())
  ) {
    return {
      score: 0,
      urgency: "descartar",
      breakdown: [{ signal: "business_status", pts: 0, note: `Cerrado (${lead.businessStatus})` }]
    };
  }

  const b: ScoreBreakdownItem[] = [];
  let total = 0;

  // Posición ranking 0-25
  const pos = lead.position ?? null;
  let posPts = 0;
  let posNote = "";
  if (pos === null || pos === undefined) {
    posPts = 5;
    posNote = "Posición desconocida";
  } else if (pos === 1) {
    posPts = 0;
    posNote = "#1, no necesita ayuda";
  } else if (pos >= 4 && pos <= 15) {
    posPts = 25;
    posNote = `Posición ${pos}: punto dulce`;
  } else if (pos >= 2 && pos <= 3) {
    posPts = 18;
    posNote = `Posición ${pos}: casi líder`;
  } else if (pos <= 30) {
    posPts = 12;
    posNote = `Posición ${pos}: lejos pero alcanzable`;
  } else {
    posPts = 5;
    posNote = `Posición ${pos}: muy abajo`;
  }
  total += posPts;
  b.push({ signal: "position", pts: posPts, note: posNote });

  // Rating INVERTIDO 0-20
  const r = lead.rating;
  let rPts = 0;
  let rNote = "";
  if (r == null) {
    rPts = 12;
    rNote = "Sin rating (ficha nueva)";
  } else if (r < 3.0) {
    rPts = 20;
    rNote = `Rating ${r}: crítico`;
  } else if (r < 3.5) {
    rPts = 18;
    rNote = `Rating ${r}: bajo`;
  } else if (r < 4.0) {
    rPts = 13;
    rNote = `Rating ${r}: medio`;
  } else if (r < 4.5) {
    rPts = 8;
    rNote = `Rating ${r}: bueno`;
  } else {
    rPts = 3;
    rNote = `Rating ${r}: excelente`;
  }
  total += rPts;
  b.push({ signal: "rating", pts: rPts, note: rNote });

  // % reseñas negativas 0-15
  let neg = lead.negativePct;
  if (neg == null && r != null) {
    // Estima desde rating si no hay desglose
    if (r < 3.0) neg = 50;
    else if (r < 3.5) neg = 30;
    else if (r < 4.0) neg = 15;
    else neg = 5;
  }
  let nPts = 0;
  let nNote = "";
  if (neg == null) {
    nPts = 0;
    nNote = "Sin datos reseñas negativas";
  } else if (neg >= 30) {
    nPts = 15;
    nNote = `${neg}% reseñas negativas`;
  } else if (neg >= 15) {
    nPts = 10;
    nNote = `${neg}% reseñas negativas`;
  } else if (neg >= 5) {
    nPts = 5;
    nNote = `${neg}% reseñas negativas`;
  } else {
    nPts = 0;
    nNote = `${neg}% reseñas negativas (sano)`;
  }
  total += nPts;
  b.push({ signal: "negative_pct", pts: nPts, note: nNote });

  // Recuento reseñas 0-15 (dormidas suben)
  const cnt = lead.reviewsCount ?? 0;
  let cPts = 0;
  let cNote = "";
  if (cnt < 10) {
    cPts = 15;
    cNote = `${cnt} reseñas: ficha dormida`;
  } else if (cnt <= 30) {
    cPts = 10;
    cNote = `${cnt} reseñas: pocas`;
  } else if (cnt <= 100) {
    cPts = 7;
    cNote = `${cnt} reseñas: medio`;
  } else {
    cPts = 3;
    cNote = `${cnt} reseñas: muchas`;
  }
  total += cPts;
  b.push({ signal: "reviews_count", pts: cPts, note: cNote });

  // Competencia 0-15
  const ctop = lead.competitorTopRating;
  let kPts = 0;
  let kNote = "";
  if (ctop == null) {
    kPts = 8;
    kNote = "Sin datos competidores";
  } else if (r != null && r < ctop - 1.0) {
    kPts = 15;
    kNote = `Competidor #1 con rating ${ctop}: gap claro`;
  } else if (r != null && r >= ctop) {
    kPts = 2;
    kNote = "Mejor o igual que competidores top";
  } else {
    kPts = 8;
    kNote = "Competencia cercana";
  }
  total += kPts;
  b.push({ signal: "competition", pts: kPts, note: kNote });

  // Sin web 0-5
  let wPts = 0;
  let wNote = "";
  if (!lead.website || lead.website.trim() === "") {
    wPts = 5;
    wNote = "Sin web";
  } else {
    wPts = 0;
    wNote = "Tiene web";
  }
  total += wPts;
  b.push({ signal: "website", pts: wPts, note: wNote });

  // Bonus presencia online: aquí simplificado (5 puntos si reviewsCount>0)
  const oPts = cnt > 0 ? 5 : 0;
  b.push({ signal: "online_presence", pts: oPts, note: cnt > 0 ? "Tiene reseñas" : "Sin actividad" });
  total += oPts;

  total = Math.max(0, Math.min(100, total));

  let urgency: ScoreResult["urgency"] = "media";
  if (total >= 70) urgency = "critica";
  else if (total >= 50) urgency = "alta";
  else if (total >= 30) urgency = "media";
  else if (total >= 10) urgency = "baja";
  else urgency = "descartar";

  return { score: total, urgency, breakdown: b };
}
