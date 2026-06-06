/**
 * Utilidades sobre las reseñas de Google de un lead (guardadas en
 * Lead.reviewsJson tras enriquecer con Place Details). Sirven para citar una
 * reseña negativa REAL en el mensaje de captación ("vi la reseña de 2★…").
 */

export type PickedReview = {
  text: string;
  rating: number;
  when: string; // "hace 2 semanas" (relativePublishTimeDescription)
  author: string;
};

/** Extrae el texto de una reseña de Places (New), tolerante a shapes. */
function reviewText(r: any): string {
  return String(r?.text?.text ?? r?.originalText?.text ?? r?.text ?? "").trim();
}

/**
 * Elige la reseña NEGATIVA (≤3★) más reciente con texto. null si no hay.
 * Es la que mejor encaja con el pitch de reputación/GMB.
 */
export function pickNegativeReview(reviewsJson: unknown): PickedReview | null {
  const arr = Array.isArray(reviewsJson) ? reviewsJson : [];
  const lows = arr
    .map((r: any) => ({
      rating: Number(r?.rating ?? 0),
      text: reviewText(r),
      when: String(r?.relativePublishTimeDescription ?? ""),
      author: String(r?.authorAttribution?.displayName ?? ""),
      publishTime: String(r?.publishTime ?? "")
    }))
    .filter((r) => r.rating > 0 && r.rating <= 3 && r.text.length > 0)
    .sort((a, b) => b.publishTime.localeCompare(a.publishTime));
  if (lows.length === 0) return null;
  const { publishTime, ...rest } = lows[0];
  return rest;
}

/** Recorta un texto a `max` caracteres sin cortar a mitad de palabra (aprox). */
export function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max).replace(/\s+\S*$/, "").trim() + "…";
}
