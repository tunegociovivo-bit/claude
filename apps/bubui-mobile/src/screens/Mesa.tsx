import { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, Alert, Image, ScrollView, Linking, ActivityIndicator } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import { CheckSession } from "../lib/session";
import { api, API_BASE } from "../lib/api";
import { shareReferralForOffer } from "../lib/share-referral";
import { FadeIn } from "../components/FadeIn";
import { sfx } from "../lib/sound";
import { useTheme, type Palette, radius, shadow } from "../lib/theme";
import type { RootStackParamList } from "../../App";

type MesaRoute = RouteProp<RootStackParamList, "Mesa">;
type MesaInfo = Awaited<ReturnType<typeof api.mesaState>>;

/**
 * Mesa Colectiva — pantalla nativa del comensal.
 *
 * Se entra de dos formas:
 *  - Capitán: tras escanear el QR del local (param businessId) → crea la mesa
 *    y muestra el QR/código de grupo para que el resto se una.
 *  - Comensal: escaneando el QR de grupo (param code) → se une a la mesa.
 *
 * Cada comensal desbloquea su parte aportando (compartir/reseña). El descuento
 * lo cierra el restaurante con el importe; aquí se ve el progreso en vivo.
 */
export function Mesa() {
  const nav = useNavigation<any>();
  const route = useRoute<MesaRoute>();
  const insets = useSafeAreaInsets();
  const c = useTheme();
  const styles = makeStyles(c);
  const { businessId, code: paramCode, businessName } = route.params ?? {};

  const [customerId, setCustomerId] = useState<string | null>(null);
  const [code, setCode] = useState<string>(paramCode?.toUpperCase() ?? "");
  const [isCaptain, setIsCaptain] = useState(false);
  const [phase, setPhase] = useState<"init" | "ready" | "error">("init");
  const [errorMsg, setErrorMsg] = useState("");
  const [mesa, setMesa] = useState<MesaInfo | null>(null);
  // Aportes que YA ha hecho este comensal (el agregado del backend es de grupo).
  const [sharedByMe, setSharedByMe] = useState(false);
  const [reviewedByMe, setReviewedByMe] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const started = useRef(false);

  // Arranque: crear (capitán) o unirse (comensal), luego cargar estado.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    let alive = true;
    (async () => {
      const session = await CheckSession();
      if (!session) { nav.reset({ index: 0, routes: [{ name: "Onboarding" }] }); return; }
      if (!alive) return;
      setCustomerId(session.customerId);
      try {
        let theCode = paramCode?.toUpperCase() ?? "";
        if (paramCode) {
          await api.mesaJoin(theCode, session.customerId);
          setIsCaptain(false);
        } else if (businessId) {
          const r = await api.mesaCreate(businessId, session.customerId);
          theCode = r.code;
          setCode(r.code);
          setIsCaptain(true);
        } else {
          throw new Error("Falta el código de la mesa.");
        }
        const st = await api.mesaState(theCode);
        if (!alive) return;
        setMesa(st);
        setPhase("ready");
        sfx.tap();
      } catch (e: any) {
        if (!alive) return;
        setErrorMsg(e?.message ?? "No se pudo abrir la mesa.");
        setPhase("error");
      }
    })();
    return () => { alive = false; };
  }, []);

  // Refresco en vivo mientras la mesa siga abierta (nuevos comensales/aportes).
  useEffect(() => {
    if (phase !== "ready" || !code) return;
    if (mesa && mesa.status !== "open") return;
    const t = setInterval(async () => {
      try {
        const st = await api.mesaState(code);
        setMesa(st);
      } catch {}
    }, 5000);
    return () => clearInterval(t);
  }, [phase, code, mesa?.status]);

  function close() {
    if (nav.canGoBack()) nav.goBack();
    else nav.reset({ index: 0, routes: [{ name: "Feed" }] });
  }

  async function refresh() {
    try { const st = await api.mesaState(code); setMesa(st); } catch {}
  }

  async function doShare() {
    if (!customerId) return;
    setBusyAction("share");
    try {
      await shareReferralForOffer(customerId);
      await api.mesaContribute(code, customerId, "share");
      setSharedByMe(true);
      await refresh();
    } catch (e: any) {
      Alert.alert("No se pudo registrar el aporte", e?.message ?? "");
    } finally {
      setBusyAction(null);
    }
  }

  async function doReview() {
    if (!customerId) return;
    const reviewUrl = mesa?.business.reviewUrl;
    if (!reviewUrl) {
      Alert.alert("Reseña no disponible", "Este negocio aún no tiene el enlace de reseña configurado.");
      return;
    }
    setBusyAction("review");
    try {
      await Linking.openURL(reviewUrl);
      await api.mesaContribute(code, customerId, "review");
      setReviewedByMe(true);
      await refresh();
    } catch (e: any) {
      Alert.alert("No se pudo abrir la reseña", e?.message ?? "");
    } finally {
      setBusyAction(null);
    }
  }

  async function shareCode() {
    sfx.tap();
    if (customerId) void shareReferralForOffer(customerId);
  }

  // ── Estados de carga / error ──────────────────────────────────────────────
  if (phase === "init") {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={c.pink} size="large" />
        <Text style={styles.muted}>{paramCode ? "Uniéndote a la mesa…" : "Creando la mesa…"}</Text>
      </View>
    );
  }
  if (phase === "error" || !mesa) {
    return (
      <View style={[styles.center, { padding: 24 }]}>
        <Text style={{ fontSize: 56 }}>😕</Text>
        <Text style={styles.bigTitle}>No se pudo abrir la mesa</Text>
        <Text style={styles.muted}>{errorMsg}</Text>
        <TouchableOpacity style={styles.btn} onPress={close}>
          <Text style={styles.btnText}>Volver</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const st = mesa.state;
  const biz = mesa.business;
  const actions = biz.actions ?? [];

  // ── Mesa cerrada por el restaurante ───────────────────────────────────────
  if (mesa.status === "redeemed") {
    return (
      <View style={[styles.center, { padding: 24 }]}>
        <Text style={{ fontSize: 64 }}>🎉</Text>
        <FadeIn delay={120} dy={10} style={{ alignItems: "center", gap: 10 }}>
          <Text style={styles.bigTitle}>¡Mesa cerrada!</Text>
          <Text style={styles.muted}>
            Se aplicó un <Text style={styles.strong}>{st?.pctNow ?? 0}%</Text> a la cuenta del grupo
            {st && st.pctNextVisit > 0 ? ` y os habéis guardado un ${st.pctNextVisit}% para la próxima visita` : ""}.
          </Text>
          <TouchableOpacity style={styles.btn} onPress={() => nav.reset({ index: 0, routes: [{ name: "Feed" }] })}>
            <Text style={styles.btnText}>Ver mi ahorro</Text>
          </TouchableOpacity>
        </FadeIn>
      </View>
    );
  }
  if (mesa.status === "expired") {
    return (
      <View style={[styles.center, { padding: 24 }]}>
        <Text style={{ fontSize: 56 }}>⌛</Text>
        <Text style={styles.bigTitle}>La mesa ha caducado</Text>
        <Text style={styles.muted}>Se acabó la ventana para unirse. Escanea de nuevo para crear otra.</Text>
        <TouchableOpacity style={styles.btn} onPress={close}>
          <Text style={styles.btnText}>Volver</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ── Mesa abierta ──────────────────────────────────────────────────────────
  const shareDone = sharedByMe;
  const reviewDone = reviewedByMe;
  return (
    <ScrollView style={{ flex: 1, backgroundColor: c.bg }} contentContainerStyle={{ padding: 20, paddingTop: insets.top + 16, paddingBottom: 48 }}>
      <TouchableOpacity onPress={close} hitSlop={8} style={{ marginBottom: 8 }}>
        <Text style={styles.backText}>‹ Cerrar</Text>
      </TouchableOpacity>

      <Text style={styles.kicker}>🍽️ MESA COLECTIVA</Text>
      <Text style={styles.title}>{biz.name || businessName || "Tu mesa"}</Text>
      <Text style={styles.muted}>Sois {st?.diners ?? 1} en la mesa{mesa.tableLabel ? ` · ${mesa.tableLabel}` : ""}.</Text>

      {/* Indicador de descuento */}
      <View style={styles.hero}>
        <Text style={styles.heroPct}>{st?.pctNow ?? 0}%</Text>
        <Text style={styles.heroLabel}>descuento ahora mismo</Text>
        <View style={styles.heroRow}>
          {st && st.pctNextVisit > 0 && (
            <Text style={styles.heroSub}>+{st.pctNextVisit}% próxima visita</Text>
          )}
          {st && (
            <Text style={styles.heroSub}>hasta {st.maxPotentialPct}% si lo completáis</Text>
          )}
        </View>
        {!!biz.perkLabel && <Text style={styles.perk}>🎁 {biz.perkLabel} para la próxima visita</Text>}
      </View>

      {/* Capitán: QR + código para que se unan los demás */}
      {isCaptain && (
        <View style={styles.qrCard}>
          <Text style={styles.qrTitle}>Que el resto escanee este QR</Text>
          <Image
            source={{ uri: `${API_BASE}/api/bubui/table/${encodeURIComponent(code)}/qr.png` }}
            style={styles.qrImg}
            resizeMode="contain"
          />
          <Text style={styles.codeBig}>{code}</Text>
          <Text style={styles.muted}>o que tecleen este código en su app.</Text>
          <TouchableOpacity style={styles.secondaryBtn} onPress={shareCode}>
            <Text style={styles.secondaryBtnText}>📲 Compartir invitación</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Checklist de pasos */}
      {!!st?.steps?.length && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Para subir el descuento</Text>
          {st.steps.map((s) => (
            <View key={s.key} style={styles.stepRow}>
              <Text style={[styles.stepCheck, s.done && styles.stepCheckDone]}>{s.done ? "✓" : "○"}</Text>
              <Text style={[styles.stepLabel, s.done && styles.stepLabelDone]}>{s.label}</Text>
              <Text style={styles.stepPct}>+{s.pct}%</Text>
            </View>
          ))}
        </View>
      )}

      {/* Mi aporte */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Tu aporte para desbloquear tu parte</Text>
        {actions.includes("share") && (
          <TouchableOpacity
            style={[styles.actionBtn, shareDone && styles.actionBtnDone]}
            onPress={doShare}
            disabled={busyAction !== null || shareDone}
          >
            <Text style={[styles.actionBtnText, shareDone && styles.actionBtnTextDone]}>
              {busyAction === "share" ? "Abriendo…" : shareDone ? "✓ Has invitado a amigos" : "📲 Invitar amigos"}
            </Text>
          </TouchableOpacity>
        )}
        {actions.includes("review") && (
          <TouchableOpacity
            style={[styles.actionBtn, reviewDone && styles.actionBtnDone]}
            onPress={doReview}
            disabled={busyAction !== null || reviewDone}
          >
            <Text style={[styles.actionBtnText, reviewDone && styles.actionBtnTextDone]}>
              {busyAction === "review" ? "Abriendo…" : reviewDone ? `✓ Reseña en ${biz.reviewPlatformLabel}` : `⭐ Dejar reseña en ${biz.reviewPlatformLabel}`}
            </Text>
          </TouchableOpacity>
        )}
        <Text style={styles.hint}>Cada comensal elige una acción. La que no elijas te llegará luego como cupón para tu próxima visita.</Text>
      </View>

      <Text style={styles.footer}>
        El restaurante cierra la mesa con el importe de la cuenta y tu descuento se aplica automáticamente. Mantén esta pantalla abierta.
      </Text>
    </ScrollView>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    center: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: c.bg, gap: 12, padding: 24 },
    muted: { color: c.gray, textAlign: "center", fontSize: 14, lineHeight: 20 },
    strong: { fontWeight: "900", color: c.pinkDeep },
    backText: { color: c.gray, fontSize: 16, fontWeight: "800" },
    kicker: { color: c.pinkDeep, fontSize: 12, fontWeight: "900", letterSpacing: 1, marginTop: 4 },
    title: { fontSize: 26, fontWeight: "900", color: c.black, letterSpacing: -0.5, marginTop: 2, marginBottom: 4 },
    bigTitle: { fontSize: 22, fontWeight: "900", color: c.black, textAlign: "center" },
    // Hero del descuento.
    hero: { marginTop: 16, backgroundColor: c.pinkWash, borderRadius: radius.xl, paddingVertical: 22, paddingHorizontal: 18, alignItems: "center", borderWidth: 2, borderColor: c.pinkSoft },
    heroPct: { fontSize: 56, fontWeight: "900", color: c.pinkDeep, letterSpacing: -1 },
    heroLabel: { fontSize: 13, fontWeight: "800", color: c.pinkDeep, marginTop: -4 },
    heroRow: { flexDirection: "row", flexWrap: "wrap", gap: 12, justifyContent: "center", marginTop: 10 },
    heroSub: { fontSize: 12, fontWeight: "700", color: c.gray },
    perk: { marginTop: 10, fontSize: 13, fontWeight: "800", color: c.green, textAlign: "center" },
    // Tarjeta QR del capitán.
    qrCard: { marginTop: 16, backgroundColor: c.white, borderRadius: radius.lg, padding: 18, alignItems: "center", ...shadow.card },
    qrTitle: { fontSize: 15, fontWeight: "800", color: c.black, marginBottom: 12 },
    qrImg: { width: 200, height: 200 },
    codeBig: { fontSize: 34, fontWeight: "900", color: c.black, letterSpacing: 6, marginTop: 10 },
    secondaryBtn: { marginTop: 14, borderRadius: radius.pill, borderWidth: 2, borderColor: c.pink, backgroundColor: c.pinkWash, paddingVertical: 12, paddingHorizontal: 22 },
    secondaryBtnText: { color: c.pinkDeep, fontSize: 14, fontWeight: "800" },
    // Tarjetas genéricas.
    card: { marginTop: 16, backgroundColor: c.white, borderRadius: radius.lg, padding: 16, ...shadow.card },
    cardTitle: { fontSize: 15, fontWeight: "900", color: c.black, marginBottom: 12 },
    stepRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 6 },
    stepCheck: { fontSize: 18, fontWeight: "900", color: c.grayLight, width: 22, textAlign: "center" },
    stepCheckDone: { color: c.green },
    stepLabel: { flex: 1, fontSize: 13, color: c.black, lineHeight: 18 },
    stepLabelDone: { color: c.gray, textDecorationLine: "line-through" },
    stepPct: { fontSize: 13, fontWeight: "900", color: c.pinkDeep },
    // Botones de aporte.
    actionBtn: { marginTop: 10, backgroundColor: c.pink, borderRadius: radius.pill, paddingVertical: 14, alignItems: "center", ...shadow.btn },
    actionBtnText: { color: c.onAccent, fontSize: 15, fontWeight: "800" },
    actionBtnDone: { backgroundColor: c.pinkWash, shadowOpacity: 0, elevation: 0, borderWidth: 1.5, borderColor: c.green },
    actionBtnTextDone: { color: c.green },
    hint: { marginTop: 12, fontSize: 12, color: c.gray, lineHeight: 17 },
    footer: { marginTop: 20, fontSize: 12, color: c.gray, textAlign: "center", lineHeight: 18, paddingHorizontal: 8 },
    btn: { marginTop: 24, backgroundColor: c.pink, borderRadius: radius.pill, paddingVertical: 15, paddingHorizontal: 32, ...shadow.btn },
    btnText: { color: c.onAccent, fontSize: 16, fontWeight: "800" }
  });
