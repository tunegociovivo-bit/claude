import { parseAndroidUiNodes, type AndroidUiPoint } from "@/components/mobile/android-ui-hierarchy";

/**
 * MIUI y otras capas muestran «Abrir con» cuando hay dos copias de la app
 * (app dual / segundo espacio). Devuelve el punto de la PRIMERA opción que
 * coincide con la app (la instalación principal), o null si no hay selector.
 */
const CHOOSER_TITLE = /^(Abrir con|Open with|Completar acción( con)?|Complete action( using)?|Abrir mediante|Elige una aplicación|Choose an app)/i;

export function findAppChooserTarget(hierarchy: string, appLabel: RegExp): AndroidUiPoint | null {
  const nodes = parseAndroidUiNodes(hierarchy);
  if (!nodes.some((node) => CHOOSER_TITLE.test((node.text || node.contentDescription).trim()))) return null;
  const options = nodes
    .filter((node) => appLabel.test((node.text || node.contentDescription).trim()))
    .sort((a, b) => a.bounds.top - b.bounds.top || a.bounds.left - b.bounds.left);
  return options[0]?.center ?? null;
}

export const APP_LABELS = {
  facebook: /^Facebook( Lite)?$/i,
  instagram: /^Instagram( Lite)?$/i,
  tiktok: /^TikTok( Lite)?$/i
} as const;
