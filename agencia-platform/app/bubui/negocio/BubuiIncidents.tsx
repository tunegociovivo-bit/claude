"use client";
import { useState } from 'react';
export default function BubuiIncidents({ businessId, token }: { businessId: string; token: string }) {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function load() {
    setBusy(true); setError('');
    try {
      const response = await fetch(`/api/bubui/business/${businessId}/incidents`, { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) throw new Error();
      setData(await response.json());
    } catch { setError('No se pudieron cargar las incidencias. Vuelve a intentarlo.'); }
    finally { setBusy(false); }
  }
  async function retry(id: string) {
    setBusy(true);
    try {
      const response = await fetch(`/api/bubui/business/${businessId}/incidents`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
      if (!response.ok || !(await response.json()).ok) throw new Error();
      await load();
    } catch { setError('El aviso continúa pendiente. La reserva sigue guardada.'); }
    finally { setBusy(false); }
  }
  return <section className="rounded-2xl border bg-white p-4 space-y-3">
    <h2 className="font-bold">Incidencias y pendientes</h2>
    <button type="button" onClick={load} disabled={busy} className="text-pink-700 underline">{busy ? 'Cargando…' : 'Consultar / actualizar'}</button>
    {error && <p role="alert">{error}</p>}
    {data && <>
      <p>{data.purchases.length} compras pendientes o con reto por actualizar · {data.pendingProofs} pruebas por revisar · {data.ads.length} anuncios por comprobar.</p>
      <p className="text-sm">Las compras y pruebas se resuelven en sus secciones del panel. Los anuncios con envío interrumpido requieren comprobar su entrega antes de repetirlos.</p>
      {data.notices.map((n: any) => <div key={n.id} className="border-t pt-2"><p>{n.lastError || 'Aviso pendiente'} · {new Date(n.createdAt).toLocaleString('es-ES')}</p>{n.status === 'failed' && <button type="button" disabled={busy} onClick={() => retry(n.id)} className="text-pink-700 underline">Reintentar aviso</button>}</div>)}
      {!data.notices.length && <p>No hay avisos pendientes de envío.</p>}
    </>}
  </section>;
}
