import { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, Alert, Image, ScrollView, Linking, ActivityIndicator, Animated } from "react-native";
import { CameraView, Camera } from "expo-camera";
import * as ImagePicker from "expo-image-picker";
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
type Bill = Awaited<ReturnType<typeof api.mesaBill>>;
type View_ = "mesa" | "finish" | "ticketcam" | "bill";

/**
 * Mesa Colectiva — pantalla nativa del comensal.
 *
 * Capitán: crea la mesa (param businessId) y muestra el QR/código de grupo.
 * Comensal: se une (param code). Cada uno desbloquea SU parte con una acción
 * (su estado propio lo da el servidor). Al pagar, quien paga pulsa "Terminar"
 * → escanea el ticket → ve la cuenta con el descuento aplicado para enseñársela
 * al camarero. La cuenta queda registrada en el panel del negocio.
 */
/**
 * Aviso LLAMATIVO (pulsante) para el camarero: hay acciones que la IA no pudo
 * validar y se aceptaron de forma provisional; debe comprobarlas a mano antes de
 * aplicar el descuento.
 */
function ProvisionalBanner({ count }: { count: number }) {
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 600, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 600, useNativeDriver: true })
      ])
    );
    loop.start();
    return () => loop.stop();
  }, []);
  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.18] });
  return (
    <View style={{ marginTop: 16, backgroundColor: "#FEF3C7", borderColor: "#F59E0B", borderWidth: 2, borderRadius: 16, padding: 14, flexDirection: "row", alignItems: "center", gap: 12 }}>
      <Animated.Text style={{ fontSize: 30, transform: [{ scale }] }}>⚠️</Animated.Text>
      <View style={{ flex: 1 }}>
        <Text style={{ fontWeight: "900", color: "#92400E", fontSize: 14 }}>Camarero: verifica {count} acción{count === 1 ? "" : "es"}</Text>
        <Text style={{ color: "#92400E", fontSize: 12, lineHeight: 17, marginTop: 2 }}>No se pudieron validar automáticamente. Comprueba la reseña/publicación antes de aplicar el descuento.</Text>
      </View>
    </View>
  );
}

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
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [view, setView] = useState<View_>("mesa");
  const [bill, setBill] = useState<Bill | null>(null);
  const [ticketReading, setTicketReading] = useState(false);
  const ticketCamRef = useRef<CameraView>(null);
  const started = useRef(false);

  async function fetchState(theCode: string, cid: string) {
    return api.mesaState(theCode, { me: cid });
  }

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
        const st = await fetchState(theCode, session.customerId);
        if (!alive) return;
        setMesa(st);
        if (st.status === "redeemed") setView("bill");
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

  // Refresco en vivo mientras la mesa siga abierta y no estemos en cámara/cuenta.
  useEffect(() => {
    if (phase !== "ready" || !code || !customerId) return;
    if (mesa && mesa.status !== "open") return;
    if (view === "ticketcam" || view === "bill") return;
    const t = setInterval(async () => {
      try {
        const st = await fetchState(code, customerId);
        setMesa(st);
        if (st.status === "redeemed") { setView("bill"); }
      } catch {}
    }, 5000);
    return () => clearInterval(t);
  }, [phase, code, customerId, mesa?.status, view]);

  function close() {
    if (nav.canGoBack()) nav.goBack();
    else nav.reset({ index: 0, routes: [{ name: "Feed" }] });
  }
  async function refresh() {
    if (!customerId) return;
    try { setMesa(await fetchState(code, customerId)); } catch {}
  }

  // Invitar amigos (crecimiento): comparte el enlace; el premio es la hucha de
  // próxima visita por cada amigo que se da de alta. No cuenta para el bote.
  async function invite() {
    if (!customerId) return;
    setBusyAction("share");
    try {
      await shareReferralForOffer(customerId);
      await api.mesaContribute(code, customerId, "share");
      await refresh();
    } catch (e: any) {
      Alert.alert("No se pudo compartir", e?.message ?? "");
    } finally {
      setBusyAction(null);
    }
  }

  // Abre la plataforma de reseña (ayuda para dejar la reseña antes de la captura).
  async function openReviewLink() {
    const url = mesa?.business.reviewUrl;
    if (!url) { Alert.alert("Reseña no disponible", "Este negocio aún no tiene el enlace de reseña configurado."); return; }
    await Linking.openURL(url);
  }

  // Sube una captura (reseña o publicación social) → la IA la valida y, si es
  // válida, suma una acción al bote común de la mesa.
  async function uploadAction(type: "review" | "social") {
    if (!customerId) return;
    setBusyAction(type);
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) { Alert.alert("Permiso necesario", "Necesitamos acceso a tus fotos para subir la captura."); return; }
      const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.7 });
      if (res.canceled || !res.assets?.[0]?.uri) return;
      const r = await api.mesaVerifyAction(code, customerId, type, res.assets[0].uri, mesa?.ticketAmount ?? undefined);
      if (r.valid) {
        sfx.success();
        Alert.alert(r.provisional ? "Recibido ✓" : "¡Verificado! ✓", r.reason);
      } else {
        Alert.alert("No hemos podido validar la captura", r.reason + "\n\nAsegúrate de que se vea bien y vuelve a intentarlo.");
      }
      await refresh();
    } catch (e: any) {
      Alert.alert("No se pudo subir la captura", e?.message ?? "");
    } finally {
      setBusyAction(null);
    }
  }

  async function captureTicket() {
    const cam = ticketCamRef.current;
    if (!cam || !customerId) return;
    setTicketReading(true);
    try {
      const photo = await cam.takePictureAsync({ quality: 0.6, skipProcessing: true });
      if (!photo?.uri) throw new Error("No se pudo capturar la foto");
      const r = await api.readTicket(customerId, photo.uri);
      const b = await api.mesaBill(code, customerId, r.ticketScanId ? { ticketScanId: r.ticketScanId } : { ticketAmount: r.amount ?? undefined });
      setBill(b);
      setView("bill");
      sfx.success();
    } catch (e: any) {
      Alert.alert("No se pudo leer el ticket", (e?.message ?? "") + "\nInténtalo de nuevo con el ticket bien encuadrado.");
    } finally {
      setTicketReading(false);
    }
  }

  // ── Carga / error ──────────────────────────────────────────────────────────
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
        <TouchableOpacity style={styles.btn} onPress={close}><Text style={styles.btnText}>Volver</Text></TouchableOpacity>
      </View>
    );
  }

  const st = mesa.state;
  const biz = mesa.business;
  const actions = biz.actions ?? [];
  const me = mesa.me;
  const iShared = !!me?.sharedDone;
  const iReviewVerified = !!me?.reviewVerified;
  const iSocialVerified = !!me?.socialVerified;
  const canReview = actions.includes("review");
  const canSocial = actions.includes("photo") || actions.includes("follow");
  const canInvite = actions.includes("share");

  // Botones de acción verificable (reseña / publicación social) reutilizados en
  // la mesa y en la pantalla "Terminar". Cualquiera puede aportar al bote.
  const renderActions = () => (
    <>
      {canReview && (
        <View style={{ marginTop: 10 }}>
          <Text style={styles.actionLabel}>⭐ Reseña en {biz.reviewPlatformLabel}</Text>
          {!iReviewVerified && !!biz.reviewUrl && (
            <TouchableOpacity style={styles.linkBtn} onPress={openReviewLink} disabled={busyAction !== null}>
              <Text style={styles.linkBtnText}>1 · Abrir {biz.reviewPlatformLabel} para dejar la reseña</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity style={[styles.actionBtn, iReviewVerified && styles.actionBtnDone]} onPress={() => uploadAction("review")} disabled={busyAction !== null || iReviewVerified}>
            <Text style={[styles.actionBtnText, iReviewVerified && styles.actionBtnTextDone]}>
              {busyAction === "review" ? "Validando…" : iReviewVerified ? "✓ Reseña verificada" : `${biz.reviewUrl ? "2 · " : ""}Subir captura de la reseña`}
            </Text>
          </TouchableOpacity>
        </View>
      )}
      {canSocial && (
        <View style={{ marginTop: 12 }}>
          <Text style={styles.actionLabel}>📸 Foto de grupo en tus redes etiquetando a {biz.name}</Text>
          <TouchableOpacity style={[styles.actionBtn, iSocialVerified && styles.actionBtnDone]} onPress={() => uploadAction("social")} disabled={busyAction !== null || iSocialVerified}>
            <Text style={[styles.actionBtnText, iSocialVerified && styles.actionBtnTextDone]}>
              {busyAction === "social" ? "Validando…" : iSocialVerified ? "✓ Publicación verificada" : "Subir captura de tu publicación"}
            </Text>
          </TouchableOpacity>
        </View>
      )}
    </>
  );

  // ── Pantalla de CUENTA (con descuento aplicado) ────────────────────────────
  if (view === "bill" || mesa.status === "redeemed") {
    const pct = bill?.appliedPct ?? mesa.finalPct ?? st?.pctNow ?? 0;
    const ticket = bill?.ticket ?? mesa.ticketAmount ?? st?.euros?.ticket ?? null;
    const payNow = bill?.payNow ?? (ticket != null ? Math.round((ticket - (ticket * pct) / 100) * 100) / 100 : null);
    const saved = bill?.savedNow ?? (ticket != null ? Math.round(((ticket * pct) / 100) * 100) / 100 : null);
    const nextVisitPct = bill?.nextVisitPct ?? st?.pctNextVisit ?? 0;
    const perk = bill?.perk ?? null;
    return (
      <ScrollView style={{ flex: 1, backgroundColor: c.bg }} contentContainerStyle={{ padding: 20, paddingTop: insets.top + 16, paddingBottom: 48 }}>
        <Text style={styles.kicker}>🧾 CUENTA CON DESCUENTO</Text>
        <Text style={styles.title}>{biz.name || businessName || "Tu mesa"}</Text>

        <View style={styles.billCard}>
          {ticket != null && <Text style={styles.billRow}>Total cuenta: <Text style={styles.billStrong}>{ticket.toFixed(2)} €</Text></Text>}
          <Text style={styles.billRow}>Descuento del grupo: <Text style={styles.billStrong}>{pct}%</Text></Text>
          {saved != null && <Text style={styles.billRow}>Os ahorráis: <Text style={[styles.billStrong, { color: c.green }]}>{saved.toFixed(2)} €</Text></Text>}
          {payNow != null && (
            <>
              <View style={styles.billDivider} />
              <Text style={styles.payLabel}>A pagar</Text>
              <Text style={styles.payAmount}>{payNow.toFixed(2)} €</Text>
            </>
          )}
        </View>

        <View style={styles.waiterBox}>
          <Text style={styles.waiterTitle}>📣 Llama al camarero</Text>
          <Text style={styles.waiterText}>Muéstrale esta pantalla al pagar para que te apliquen el {pct}% de descuento de la mesa.</Text>
        </View>

        {(st?.provisionalActions ?? 0) > 0 && <ProvisionalBanner count={st!.provisionalActions} />}

        {(nextVisitPct > 0 || perk) && (
          <View style={styles.nextBox}>
            <Text style={styles.nextText}>
              🎁 Para vuestra próxima visita: {perk ? perk : `${nextVisitPct}% guardado`}.
            </Text>
          </View>
        )}

        {/* Acciones realizadas */}
        {!!st?.steps?.length && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Lo que habéis hecho</Text>
            {st.steps.map((s) => (
              <View key={s.key} style={styles.stepRow}>
                <Text style={[styles.stepCheck, s.done && styles.stepCheckDone]}>{s.done ? "✓" : "○"}</Text>
                <Text style={[styles.stepLabel, s.done && styles.stepLabelDone]}>{s.label}</Text>
                {s.pct > 0 && <Text style={styles.stepPct}>+{s.pct}%</Text>}
              </View>
            ))}
          </View>
        )}

        <TouchableOpacity style={styles.btn} onPress={() => nav.reset({ index: 0, routes: [{ name: "Feed" }] })}>
          <Text style={styles.btnText}>Hecho</Text>
        </TouchableOpacity>
      </ScrollView>
    );
  }

  if (mesa.status === "expired") {
    return (
      <View style={[styles.center, { padding: 24 }]}>
        <Text style={{ fontSize: 56 }}>⌛</Text>
        <Text style={styles.bigTitle}>La mesa ha caducado</Text>
        <Text style={styles.muted}>Se acabó la ventana para unirse. Escanea de nuevo para crear otra.</Text>
        <TouchableOpacity style={styles.btn} onPress={close}><Text style={styles.btnText}>Volver</Text></TouchableOpacity>
      </View>
    );
  }

  // ── Cámara del ticket ──────────────────────────────────────────────────────
  if (view === "ticketcam") {
    return (
      <View style={{ flex: 1, backgroundColor: "#000" }}>
        <CameraView ref={ticketCamRef} style={{ flex: 1 }} />
        <View style={[styles.topBar, { top: insets.top + 8 }]} pointerEvents="box-none">
          <TouchableOpacity style={styles.roundBtn} onPress={() => setView("finish")} hitSlop={8} disabled={ticketReading}>
            <Text style={styles.roundBtnText}>✕</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.ticketFrame} pointerEvents="none" />
        <View style={styles.overlayHint}>
          {ticketReading ? (
            <Text style={styles.overlayText}>Leyendo el ticket con IA…</Text>
          ) : (
            <>
              <Text style={styles.overlayText}>Encuadra el ticket completo (el total de la mesa)</Text>
              <TouchableOpacity style={styles.shutter} onPress={captureTicket}>
                <Text style={styles.shutterText}>Hacer foto</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </View>
    );
  }

  // ── Pantalla "Terminar" ────────────────────────────────────────────────────
  if (view === "finish") {
    return (
      <ScrollView style={{ flex: 1, backgroundColor: c.bg }} contentContainerStyle={{ padding: 20, paddingTop: insets.top + 16, paddingBottom: 48 }}>
        <TouchableOpacity onPress={() => setView("mesa")} hitSlop={8} style={{ marginBottom: 8 }}>
          <Text style={styles.backText}>‹ Volver a la mesa</Text>
        </TouchableOpacity>
        {!st?.unlocked ? (
          <>
            <Text style={{ fontSize: 48 }}>📝</Text>
            <Text style={[styles.title, { marginTop: 6 }]}>Faltan acciones para el descuento</Text>
            <Text style={styles.muted}>
              La mesa necesita {st?.requiredActions ?? 0} acciones y lleváis {st?.verifiedActions ?? 0}. Las puede completar <Text style={{ fontWeight: "800" }}>cualquiera</Text> de la mesa (sube tú una de más si alguien no puede):
            </Text>
            <View style={{ marginTop: 12 }}>{renderActions()}</View>
          </>
        ) : (
          <>
            <Text style={{ fontSize: 48 }}>✅</Text>
            <Text style={[styles.title, { marginTop: 6 }]}>¡Tu parte está lista!</Text>
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Para pagar con descuento</Text>
              <Text style={styles.stepLabel}>1. Pedid la cuenta al camarero.</Text>
              <Text style={[styles.stepLabel, { marginTop: 6 }]}>2. Quien pague, escanea el ticket aquí abajo.</Text>
              <Text style={[styles.stepLabel, { marginTop: 6 }]}>3. Enseña la pantalla del total con descuento al camarero.</Text>
            </View>
            <TouchableOpacity
              style={styles.btn}
              onPress={async () => {
                const { status } = await Camera.requestCameraPermissionsAsync();
                if (status !== "granted") { Alert.alert("Cámara necesaria", "Necesitamos la cámara para leer el ticket."); return; }
                setView("ticketcam");
              }}
            >
              <Text style={styles.btnText}>📷 Escanear el ticket</Text>
            </TouchableOpacity>
            <Text style={[styles.hint, { textAlign: "center" }]}>Solo lo escanea UNA persona (quien paga). El descuento es para toda la mesa.</Text>
          </>
        )}
      </ScrollView>
    );
  }

  // ── Mesa abierta (vista principal) ─────────────────────────────────────────
  return (
    <ScrollView style={{ flex: 1, backgroundColor: c.bg }} contentContainerStyle={{ padding: 20, paddingTop: insets.top + 16, paddingBottom: 48 }}>
      <TouchableOpacity onPress={close} hitSlop={8} style={{ marginBottom: 8 }}>
        <Text style={styles.backText}>‹ Cerrar</Text>
      </TouchableOpacity>

      <Text style={styles.kicker}>🍽️ MESA COLECTIVA</Text>
      <Text style={styles.title}>{biz.name || businessName || "Tu mesa"}</Text>
      <Text style={styles.muted}>Sois {st?.diners ?? 1} en la mesa{mesa.tableLabel ? ` · ${mesa.tableLabel}` : ""}.</Text>

      <View style={styles.hero}>
        <Text style={styles.heroPct}>{st?.unlocked ? (st?.pctNow ?? 0) : (st?.maxPotentialPct ?? 0)}%</Text>
        <Text style={styles.heroLabel}>descuento del grupo</Text>
        <View style={styles.heroRow}>
          {st && st.unlocked && <Text style={[styles.heroSub, { color: c.green }]}>✓ desbloqueado</Text>}
          {st && !st.unlocked && (
            <Text style={styles.heroSub}>
              {st.quorum
                ? `faltan ${st.actionsRemaining} acción${st.actionsRemaining === 1 ? "" : "es"} de ${st.requiredActions}`
                : `sed ${(st.requiredActions || 1)}+ en la mesa`}
            </Text>
          )}
        </View>
        {!!biz.perkLabel && <Text style={styles.perk}>🎁 {biz.perkLabel} para la próxima visita</Text>}
      </View>

      {/* Capitán: QR + código */}
      {isCaptain && (
        <View style={styles.qrCard}>
          <Text style={styles.qrTitle}>Que el resto escanee este QR</Text>
          <Image source={{ uri: `${API_BASE}/api/bubui/table/${encodeURIComponent(code)}/qr.png` }} style={styles.qrImg} resizeMode="contain" />
          <Text style={styles.codeBig}>{code}</Text>
          <Text style={styles.muted}>o que tecleen este código en su app.</Text>
        </View>
      )}

      {/* Acciones de la mesa: bote común (N acciones = N comensales). */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Acciones de la mesa {st?.unlocked ? "✓" : `${st?.verifiedActions ?? 0}/${st?.requiredActions ?? 0}`}</Text>
        <Text style={styles.hint}>
          Desbloqueáis el descuento al juntar <Text style={{ fontWeight: "800", color: c.pinkDeep }}>{st?.requiredActions ?? 0} acciones</Text> (una por comensal). Es un bote común: cualquiera puede subir <Text style={{ fontWeight: "800", color: c.pinkDeep }}>de más</Text> para cubrir a quien no pueda. Sube la captura y la verificamos al instante.
        </Text>
        {renderActions()}
        {!canReview && !canSocial && <Text style={styles.hint}>Este restaurante aún no ha activado acciones.</Text>}
        {(st?.provisionalActions ?? 0) > 0 && (
          <Text style={[styles.hint, { color: "#B45309", fontWeight: "800" }]}>⚠️ {st!.provisionalActions} acción{st!.provisionalActions === 1 ? "" : "es"} sin validar: el camarero la verificará al pagar.</Text>
        )}
      </View>

      {/* Crece y gana: invitar amigos premia INSTALACIONES reales (hucha). */}
      {canInvite && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Crece y gana 📲</Text>
          <Text style={styles.hint}>Aparte del descuento de hoy: invita a tus amigos a Bubui y por <Text style={{ fontWeight: "800", color: c.pinkDeep }}>cada uno que se dé de alta</Text> sumas % en tu hucha para tu próxima visita. Comparte con 5+ (no todos se instalan).</Text>
          <TouchableOpacity style={[styles.actionBtn, iShared && styles.actionBtnDone]} onPress={invite} disabled={busyAction !== null || iShared}>
            <Text style={[styles.actionBtnText, iShared && styles.actionBtnTextDone]}>{busyAction === "share" ? "Abriendo…" : iShared ? "✓ Has compartido" : "📲 Invitar amigos"}</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Progreso del GRUPO (informativo) */}
      {!!st?.steps?.length && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Progreso del grupo</Text>
          {st.steps.map((s) => (
            <View key={s.key} style={styles.stepRow}>
              <Text style={[styles.stepCheck, s.done && styles.stepCheckDone]}>{s.done ? "✓" : "○"}</Text>
              <Text style={[styles.stepLabel, s.done && styles.stepLabelDone]}>{s.label}</Text>
              {s.pct > 0 && <Text style={styles.stepPct}>+{s.pct}%</Text>}
            </View>
          ))}
        </View>
      )}

      {/* Terminar */}
      <TouchableOpacity style={styles.btn} onPress={() => setView("finish")}>
        <Text style={styles.btnText}>Terminar y pagar</Text>
      </TouchableOpacity>
      <Text style={styles.footer}>Cuando vayáis a pagar, pulsa “Terminar y pagar”.</Text>
    </ScrollView>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    center: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: c.bg, gap: 12, padding: 24 },
    muted: { color: c.gray, textAlign: "center", fontSize: 14, lineHeight: 20 },
    backText: { color: c.gray, fontSize: 16, fontWeight: "800" },
    kicker: { color: c.pinkDeep, fontSize: 12, fontWeight: "900", letterSpacing: 1, marginTop: 4 },
    title: { fontSize: 26, fontWeight: "900", color: c.black, letterSpacing: -0.5, marginTop: 2, marginBottom: 4 },
    bigTitle: { fontSize: 22, fontWeight: "900", color: c.black, textAlign: "center" },
    hero: { marginTop: 16, backgroundColor: c.pinkWash, borderRadius: radius.xl, paddingVertical: 22, paddingHorizontal: 18, alignItems: "center", borderWidth: 2, borderColor: c.pinkSoft },
    heroPct: { fontSize: 56, fontWeight: "900", color: c.pinkDeep, letterSpacing: -1 },
    heroLabel: { fontSize: 13, fontWeight: "800", color: c.pinkDeep, marginTop: -4 },
    heroRow: { flexDirection: "row", flexWrap: "wrap", gap: 12, justifyContent: "center", marginTop: 10 },
    heroSub: { fontSize: 12, fontWeight: "700", color: c.gray },
    perk: { marginTop: 10, fontSize: 13, fontWeight: "800", color: c.green, textAlign: "center" },
    qrCard: { marginTop: 16, backgroundColor: c.white, borderRadius: radius.lg, padding: 18, alignItems: "center", ...shadow.card },
    qrTitle: { fontSize: 15, fontWeight: "800", color: c.black, marginBottom: 12 },
    qrImg: { width: 200, height: 200 },
    codeBig: { fontSize: 34, fontWeight: "900", color: c.black, letterSpacing: 6, marginTop: 10 },
    card: { marginTop: 16, backgroundColor: c.white, borderRadius: radius.lg, padding: 16, ...shadow.card },
    cardTitle: { fontSize: 15, fontWeight: "900", color: c.black, marginBottom: 10 },
    stepRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 6 },
    stepCheck: { fontSize: 18, fontWeight: "900", color: c.grayLight, width: 22, textAlign: "center" },
    stepCheckDone: { color: c.green },
    stepLabel: { flex: 1, fontSize: 13, color: c.black, lineHeight: 18 },
    stepLabelDone: { color: c.gray, textDecorationLine: "line-through" },
    stepPct: { fontSize: 13, fontWeight: "900", color: c.pinkDeep },
    actionBtn: { marginTop: 10, backgroundColor: c.pink, borderRadius: radius.pill, paddingVertical: 14, alignItems: "center", ...shadow.btn },
    actionBtnText: { color: c.onAccent, fontSize: 15, fontWeight: "800" },
    actionBtnDone: { backgroundColor: c.pinkWash, shadowOpacity: 0, elevation: 0, borderWidth: 1.5, borderColor: c.green },
    actionBtnTextDone: { color: c.green },
    actionLabel: { fontSize: 13, fontWeight: "800", color: c.black, marginBottom: 2 },
    linkBtn: { marginTop: 8, paddingVertical: 8, alignItems: "center" },
    linkBtnText: { color: c.pinkDeep, fontSize: 13, fontWeight: "800" },
    hint: { marginTop: 4, marginBottom: 4, fontSize: 12, color: c.gray, lineHeight: 17 },
    footer: { marginTop: 14, fontSize: 12, color: c.gray, textAlign: "center", lineHeight: 18, paddingHorizontal: 8 },
    btn: { marginTop: 20, backgroundColor: c.pink, borderRadius: radius.pill, paddingVertical: 15, paddingHorizontal: 32, alignItems: "center", ...shadow.btn },
    btnText: { color: c.onAccent, fontSize: 16, fontWeight: "800" },
    // Cuenta
    billCard: { marginTop: 16, backgroundColor: c.white, borderRadius: radius.lg, padding: 20, ...shadow.card },
    billRow: { fontSize: 15, color: c.black, marginBottom: 6 },
    billStrong: { fontWeight: "900" },
    billDivider: { height: 1, backgroundColor: c.border, marginVertical: 12 },
    payLabel: { fontSize: 13, fontWeight: "800", color: c.gray, textAlign: "center" },
    payAmount: { fontSize: 44, fontWeight: "900", color: c.pinkDeep, textAlign: "center", letterSpacing: -1 },
    waiterBox: { marginTop: 16, backgroundColor: c.pinkWash, borderRadius: radius.lg, padding: 16, borderWidth: 2, borderColor: c.pinkSoft },
    waiterTitle: { fontSize: 15, fontWeight: "900", color: c.pinkDeep },
    waiterText: { fontSize: 13, color: c.black, marginTop: 4, lineHeight: 19 },
    nextBox: { marginTop: 12, backgroundColor: c.white, borderRadius: radius.lg, padding: 14, ...shadow.card },
    nextText: { fontSize: 13, fontWeight: "700", color: c.green, textAlign: "center" },
    // Cámara
    topBar: { position: "absolute", left: 16, right: 16, flexDirection: "row", justifyContent: "space-between" },
    roundBtn: { height: 44, width: 44, borderRadius: 22, backgroundColor: "rgba(0,0,0,0.45)", alignItems: "center", justifyContent: "center" },
    roundBtnText: { color: "#FFF", fontSize: 18, fontWeight: "800" },
    overlayHint: { position: "absolute", bottom: 80, left: 0, right: 0, padding: 12, alignItems: "center" },
    overlayText: { color: "#FFF", textAlign: "center", fontSize: 15, fontWeight: "700" },
    ticketFrame: { position: "absolute", top: "16%", left: "10%", width: "80%", height: "56%", borderColor: "#FFF", borderWidth: 3, borderRadius: 18, borderStyle: "dashed" },
    shutter: { alignSelf: "center", marginTop: 16, backgroundColor: c.pink, borderRadius: radius.pill, paddingVertical: 14, paddingHorizontal: 36, ...shadow.btn },
    shutterText: { color: c.onAccent, fontSize: 16, fontWeight: "900" }
  });
