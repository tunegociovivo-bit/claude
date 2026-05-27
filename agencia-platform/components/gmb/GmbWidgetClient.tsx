"use client";

import { useEffect, useState } from "react";

type Widget = {
  name: string;
  rating: number;
  reviewCount: number;
  reviews: Array<{ author: string; photo: string; rating: number; comment: string; time: string | null }>;
};

export default function GmbWidgetClient({ id }: { id: string }) {
  const [data, setData] = useState<Widget | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    fetch(`/api/v1/gmb/widget/${id}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setData)
      .catch(() => setErr(true));
  }, [id]);

  if (err) return <div style={{ padding: 16, fontFamily: "Arial", color: "#888" }}>Reseñas no disponibles.</div>;
  if (!data) return <div style={{ padding: 16, fontFamily: "Arial", color: "#888" }}>Cargando reseñas…</div>;

  return (
    <div style={{ fontFamily: "Arial, sans-serif", padding: 12, maxWidth: 480, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, paddingBottom: 12, borderBottom: "1px solid #eee" }}>
        <div style={{ fontSize: 32, fontWeight: 800, color: "#F4600C" }}>{data.rating.toFixed(1)}</div>
        <div>
          <div style={{ color: "#F4600C", fontSize: 18 }}>{stars(Math.round(data.rating))}</div>
          <div style={{ fontSize: 13, color: "#666" }}>{data.reviewCount} reseñas en Google</div>
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 12 }}>
        {data.reviews.map((r, i) => (
          <div key={i} style={{ borderBottom: "1px solid #f2f2f2", paddingBottom: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {r.photo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={r.photo} alt="" style={{ width: 28, height: 28, borderRadius: "50%" }} />
              ) : (
                <div style={{ width: 28, height: 28, borderRadius: "50%", background: "#F4600C", color: "#fff", display: "grid", placeItems: "center", fontSize: 12 }}>
                  {(r.author || "?").slice(0, 1).toUpperCase()}
                </div>
              )}
              <span style={{ fontSize: 13, fontWeight: 600 }}>{r.author}</span>
              <span style={{ color: "#F4600C", fontSize: 13, marginLeft: "auto" }}>{stars(r.rating)}</span>
            </div>
            {r.comment && <div style={{ fontSize: 13, color: "#444", marginTop: 4 }}>{r.comment}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

function stars(n: number): string {
  return "★".repeat(Math.max(0, Math.min(5, n))) + "☆".repeat(Math.max(0, 5 - n));
}
