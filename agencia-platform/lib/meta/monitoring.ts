export type MonitoringDailyRow = { date: string; spend: number; leads: number };

export type MonitoringCampaign = {
  id: string;
  name: string;
  leads: number;
  spend: number;
  ctr: number;
  impressions: number;
};

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

export function buildFortnightBuckets(rows: MonitoringDailyRow[], now = new Date()) {
  const totals = new Map<string, { leads: number; spend: number }>();
  for (const row of rows) {
    const current = totals.get(row.date) ?? { leads: 0, spend: 0 };
    current.leads += Number(row.leads) || 0;
    current.spend += Number(row.spend) || 0;
    totals.set(row.date, current);
  }

  const days = Array.from({ length: 90 }, (_, index) => {
    const date = new Date(now);
    date.setUTCHours(12, 0, 0, 0);
    date.setUTCDate(date.getUTCDate() - (89 - index));
    const key = isoDate(date);
    return { date: key, ...(totals.get(key) ?? { leads: 0, spend: 0 }) };
  });

  return Array.from({ length: 6 }, (_, index) => {
    const chunk = days.slice(index * 15, index * 15 + 15);
    const leads = chunk.reduce((sum, item) => sum + item.leads, 0);
    const spend = chunk.reduce((sum, item) => sum + item.spend, 0);
    const from = chunk[0].date;
    const to = chunk[chunk.length - 1].date;
    const short = (value: string) => new Date(`${value}T12:00:00Z`).toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit" });
    return { label: `${short(from)}–${short(to)}`, from, to, leads, spend, cpl: leads > 0 ? spend / leads : null };
  });
}

export function buildMonitoringRecommendations(campaigns: MonitoringCampaign[], leadChangePct: number | null) {
  const spend = campaigns.reduce((sum, item) => sum + item.spend, 0);
  const leads = campaigns.reduce((sum, item) => sum + item.leads, 0);
  const recommendations: Array<{ severity: "high" | "medium" | "low"; title: string; detail: string }> = [];
  if (leadChangePct !== null && leadChangePct <= -20) recommendations.push({ severity: "high", title: "Caída relevante de leads", detail: `Los leads han bajado un ${Math.abs(leadChangePct).toFixed(0)}% frente al bloque anterior. Revisa anuncios, frecuencia, formulario y segmentación antes de aumentar presupuesto.` });
  if (spend > 0 && leads === 0) recommendations.push({ severity: "high", title: "Gasto sin leads", detail: `Se han invertido ${spend.toFixed(2)} € en 30 días sin leads atribuidos. Comprueba el evento de conversión y pausa cualquier escalado hasta validarlo.` });
  const weak = campaigns.filter((item) => item.impressions >= 1000 && item.ctr < 0.8);
  if (weak.length) recommendations.push({ severity: "medium", title: "Creatividades con CTR bajo", detail: `${weak.length} campaña(s) tienen más de 1.000 impresiones y CTR inferior al 0,8%. Conviene probar nuevos hooks, formatos y primeros segundos.` });
  if (!recommendations.length) recommendations.push({ severity: "low", title: "Rendimiento estable", detail: "No se detectan anomalías críticas con los datos disponibles. Mantén las pruebas controladas y revisa el CPL por campaña." });
  return recommendations;
}
