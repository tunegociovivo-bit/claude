import { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, TextInput, TouchableOpacity, Alert, Image, Animated, Linking } from "react-native";
import { CameraView, Camera } from "expo-camera";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Location from "expo-location";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import { CheckSession } from "../lib/session";
import { api } from "../lib/api";
import { shareReferralForOffer } from "../lib/share-referral";
import { FadeIn } from "../components/FadeIn";
import { Bouncy } from "../components/Bouncy";
import { Confetti, type ConfettiHandle } from "../components/Confetti";
import { sfx } from "../lib/sound";
import { useTheme, type Palette, radius, shadow } from "../lib/theme";
import type { RootStackParamList } from "../../App";

type ScanRoute = RouteProp<RootStackParamList, "Scan">;

export function Scan() {
  const nav = useNavigation<any>();
  const route = useRoute<ScanRoute>();
  const insets = useSafeAreaInsets();
  const c = useTheme();
  const styles = makeStyles(c);
  const initialBusinessId = route.params?.businessId || "";

  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [businessId, setBusinessId] = useState<string>(initialBusinessId);
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<any>(null);
  // customerId de la sesión, para compartir la oferta-reto desde el éxito.
  const [scanCustomerId, setScanCustomerId] = useState<string | undefined>(undefined);
  const [torch, setTorch] = useState(false);
  // Captura de ticket: "ticketCam" muestra la cámara para fotografiar el
  // ticket; "reading" mientras la IA lo procesa. ticketUrl = ticket guardado.
  const [ticketMode, setTicketMode] = useState<"off" | "cam" | "reading">("off");
  const [ticketUrl, setTicketUrl] = useState<string | undefined>(undefined);
  // Importe de confianza leído del ticket por la IA (lo usa el backend).
  const [ticketScanId, setTicketScanId] = useState<string | undefined>(undefined);
  // ¿El negocio exige foto del ticket (anti-fraude)? Se consulta al fijar el id.
  const [requireTicket, setRequireTicket] = useState(false);
  const ticketCamRef = useRef<CameraView>(null);
  // onBarcodeScanned se dispara muchas veces por segundo; el lock evita
  // procesar el mismo frame N veces (y Alerts en bucle con un QR no válido).
  const lock = useRef(false);

  // Celebración al aplicar el ahorro: confeti + "pop" del emoji.
  const confetti = useRef<ConfettiHandle>(null);
  const pop = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (done && done.status !== "rejected") {
      sfx.success();
      confetti.current?.fire();
      pop.setValue(0);
      Animated.spring(pop, { toValue: 1, useNativeDriver: true, speed: 12, bounciness: 12 }).start();
    }
  }, [done, pop]);
  const popScale = pop.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] });

  // Escanear/canjear requiere cuenta (Apple 5.1.1: el invitado puede explorar,
  // pero para recibir descuentos debe registrarse). Si no hay sesión, lo
  // mandamos al onboarding antes de pedir permiso de cámara.
  useEffect(() => {
    (async () => {
      const session = await CheckSession();
      if (!session) {
        nav.reset({ index: 0, routes: [{ name: "Onboarding" }] });
        return;
      }
      try {
        const { status } = await Camera.requestCameraPermissionsAsync();
        setHasPermission(status === "granted");
      } catch {
        // Nunca dejar la pantalla en "Pidiendo permiso…": si la petición
        // falla (p. ej. otra petición de permiso en curso), mostrar el estado
        // de denegado con su botón de reintentar.
        setHasPermission(false);
      }
    })();
  }, [nav]);

  // Al fijar el negocio (por QR o param), consulta si exige foto del ticket.
  useEffect(() => {
    let alive = true;
    if (!businessId) { setRequireTicket(false); return; }
    api.businessPublic(businessId)
      .then((b) => { if (alive) setRequireTicket(!!b.requireTicket); })
      .catch(() => {});
    return () => { alive = false; };
  }, [businessId]);

  // Cierra la pantalla de escaneo volviendo al stack anterior (o al Feed).
  function close() {
    if (nav.canGoBack()) nav.goBack();
    else nav.reset({ index: 0, routes: [{ name: "Feed" }] });
  }

  // Vuelve a la cámara para escanear otro negocio.
  function rescan() {
    lock.current = false;
    setAmount("");
    setTicketUrl(undefined);
    setTicketScanId(undefined);
    setBusinessId("");
  }

  function onScanned(result: { data: string }) {
    if (lock.current) return;
    lock.current = true;
    const m = /\/bubui\/scan\/([a-z0-9_-]+)/i.exec(result.data);
    if (m) {
      sfx.tap();
      setBusinessId(m[1]);
    } else {
      Alert.alert("QR no reconocido", "Asegúrate de escanear un QR Bubui válido.", [
        { text: "Reintentar", onPress: () => { lock.current = false; } }
      ]);
    }
  }

  // Foto del ticket → la IA lee el total → autocompleta el importe.
  async function captureTicket() {
    const cam = ticketCamRef.current;
    if (!cam) return;
    setTicketMode("reading");
    try {
      const photo = await cam.takePictureAsync({ quality: 0.6, skipProcessing: true });
      if (!photo?.uri) throw new Error("No se pudo capturar la foto");
      const session = await CheckSession();
      const r = await api.readTicket(session?.customerId ?? "anon", photo.uri);
      if (r.ticketUrl) setTicketUrl(r.ticketUrl);
      if (r.ticketScanId) setTicketScanId(r.ticketScanId);
      if (r.amount != null) {
        setAmount(String(r.amount).replace(".", ","));
        setTicketMode("off");
      } else {
        setTicketMode("off");
        Alert.alert("No pudimos leer el total", "Escribe el importe a mano; tu ticket queda guardado igualmente.");
      }
    } catch (e: any) {
      setTicketMode("off");
      Alert.alert("No se pudo leer el ticket", (e?.message ?? "") + "\nPuedes escribir el importe a mano.");
    }
  }

  async function submit() {
    sfx.tap();
    // Anti-fraude: si el negocio exige ticket, no se puede enviar sin él.
    if (requireTicket && !ticketScanId) {
      Alert.alert("Falta el ticket", "Este negocio necesita la foto del ticket para validar el importe. Pulsa «Escanear ticket».");
      return;
    }
    const value = Number(amount.replace(",", "."));
    if (!value || value <= 0) {
      Alert.alert("Importe inválido");
      return;
    }
    const session = await CheckSession();
    if (!session) {
      nav.reset({ index: 0, routes: [{ name: "Onboarding" }] });
      return;
    }
    setScanCustomerId(session.customerId);
    setBusy(true);
    try {
      let lat: number | undefined;
      let lng: number | undefined;
      try {
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        lat = loc.coords.latitude;
        lng = loc.coords.longitude;
      } catch {}
      const r = await api.scan(businessId, session.customerId, value, lat, lng, ticketUrl, ticketScanId);
      setDone(r);
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "No se pudo enviar el escaneo");
    } finally {
      setBusy(false);
    }
  }

  if (hasPermission === null) {
    return (
      <View style={[styles.center, { padding: 24 }]}>
        <Image source={require("../../assets/ill-scan.png")} style={styles.permIll} resizeMode="contain" />
        <Text style={styles.muted}>Pidiendo permiso de cámara…</Text>
      </View>
    );
  }
  if (hasPermission === false) {
    return (
      <View style={[styles.center, { padding: 24 }]}>
        <Image source={require("../../assets/ill-scan.png")} style={styles.permIll} resizeMode="contain" />
        <Text style={styles.bigTitle}>Necesitamos la cámara</Text>
        <Text style={styles.muted}>Para escanear el QR del negocio y aplicarte el descuento.</Text>
        <TouchableOpacity
          style={styles.btn}
          activeOpacity={0.85}
          onPress={async () => {
            try {
              const { status, canAskAgain } = await Camera.requestCameraPermissionsAsync();
              if (status === "granted") { setHasPermission(true); return; }
              // Denegado de forma permanente: solo se puede activar en Ajustes.
              if (!canAskAgain) Linking.openSettings().catch(() => {});
            } catch {}
          }}
        >
          <Text style={styles.btnText}>Permitir cámara</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={close} activeOpacity={0.7} style={{ marginTop: 16 }}>
          <Text style={styles.muted}>Volver</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (done) {
    const rejected = done.status === "rejected";
    const pending = done.status === "pending";
    const emoji = rejected ? "❌" : pending ? "⏳" : "🎉";
    const title = rejected
      ? "Escaneo no válido"
      : pending
      ? "¡Compra registrada!"
      : "¡Ahorro aplicado!";
    return (
      <View style={[styles.center, { padding: 24 }]}>
        {!rejected && !pending && <Confetti ref={confetti} />}
        <Animated.Text style={{ fontSize: 64, transform: rejected ? undefined : [{ scale: popScale }] }}>
          {emoji}
        </Animated.Text>
        <FadeIn delay={140} dy={10} style={{ alignItems: "center", gap: 12 }}>
          <Text style={styles.bigTitle}>{title}</Text>
          <Text style={styles.muted}>
            {rejected
              ? done.rejectionReason
              : pending
              ? `El negocio tiene que confirmar tu compra. En cuanto la valide, tu ${done.discountPct}% de descuento se sumará a "Has ahorrado".`
              : `Te has llevado un ${done.discountPct}% en esta compra${done.offersUnlocked ? ` y has desbloqueado ${done.offersUnlocked} cupones cerca` : ""}.`}
          </Text>
          {pending && (
            <Text style={[styles.muted, { fontSize: 12 }]}>
              Lo verás reflejado automáticamente; no hace falta volver a escanear.
            </Text>
          )}
          {!rejected && done.shareOffer && (
            <View style={styles.challengeBox}>
              <Text style={styles.challengeTitle}>
                🎁 ¡Oferta especial desbloqueable!
              </Text>
              <Text style={styles.challengeText}>
                Te hemos guardado{" "}
                <Text style={styles.challengeStrong}>
                  {done.shareOffer.label ? done.shareOffer.label : `un ${done.shareOffer.discountPct}%`}
                </Text>{" "}
                en {done.business?.name ?? "este negocio"}. Tráete {done.shareOffer.friends} amigos a
                Bubui para activarla.
              </Text>
              <TouchableOpacity
                style={styles.challengeShare}
                onPress={() => {
                  sfx.tap();
                  void shareReferralForOffer(scanCustomerId ?? "", {
                    businessName: done.business?.name,
                    prize: done.shareOffer.label ?? `${done.shareOffer.discountPct}%`,
                    friendsLeft: done.shareOffer.friends
                  });
                }}
              >
                <Text style={styles.challengeShareText}>📲 Compartir con mis amigos</Text>
              </TouchableOpacity>
            </View>
          )}
          <Bouncy style={styles.btn} onPress={() => nav.reset({ index: 0, routes: [{ name: "Feed" }] })}>
            <Text style={styles.btnText}>{pending ? "Entendido" : "Ver mi ahorro"}</Text>
          </Bouncy>
        </FadeIn>
      </View>
    );
  }

  if (!businessId) {
    return (
      <View style={{ flex: 1, backgroundColor: "#000" }}>
        <CameraView
          style={{ flex: 1 }}
          onBarcodeScanned={onScanned}
          barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
          enableTorch={torch}
        />
        {/* Controles superiores: cerrar + linterna */}
        <View style={[styles.topBar, { top: insets.top + 8 }]} pointerEvents="box-none">
          <TouchableOpacity style={styles.roundBtn} onPress={close} hitSlop={8}>
            <Text style={styles.roundBtnText}>✕</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.roundBtn, torch && styles.roundBtnOn]}
            onPress={() => setTorch((t) => !t)}
            hitSlop={8}
          >
            <Text style={styles.roundBtnText}>{torch ? "🔦" : "💡"}</Text>
          </TouchableOpacity>
        </View>
        {/* Marco visual de escaneo */}
        <View style={styles.scanFrame} pointerEvents="none" />
        <View style={styles.overlayHint}>
          <Text style={styles.overlayText}>Apunta al QR del negocio</Text>
        </View>
      </View>
    );
  }

  // Cámara para fotografiar el ticket (la IA leerá el total).
  if (ticketMode !== "off") {
    return (
      <View style={{ flex: 1, backgroundColor: "#000" }}>
        <CameraView ref={ticketCamRef} style={{ flex: 1 }} />
        <View style={[styles.topBar, { top: insets.top + 8 }]} pointerEvents="box-none">
          <TouchableOpacity style={styles.roundBtn} onPress={() => setTicketMode("off")} hitSlop={8} disabled={ticketMode === "reading"}>
            <Text style={styles.roundBtnText}>✕</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.ticketFrame} pointerEvents="none" />
        <View style={styles.overlayHint}>
          {ticketMode === "reading" ? (
            <Text style={styles.overlayText}>Leyendo el ticket con IA…</Text>
          ) : (
            <>
              <Text style={styles.overlayText}>Encuadra el ticket completo</Text>
              <TouchableOpacity style={styles.shutter} onPress={captureTicket}>
                <Text style={styles.shutterText}>Hacer foto</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </View>
    );
  }

  // En modo anti-fraude, el importe se bloquea hasta tener el ticket leído.
  const amountEditable = !requireTicket || !!ticketScanId;
  const numericOk = Number(amount.replace(",", ".")) > 0;
  const canSubmit = !busy && numericOk && (!requireTicket || !!ticketScanId);
  return (
    <View style={styles.amountRoot}>
      <TouchableOpacity style={[styles.backRow, { top: insets.top + 8 }]} onPress={close} hitSlop={8}>
        <Text style={styles.backText}>‹ Cerrar</Text>
      </TouchableOpacity>
      <Text style={styles.bigTitle}>¿Cuánto has pagado?</Text>
      <Text style={[styles.muted, { marginBottom: 24 }]}>
        {requireTicket
          ? "Este negocio valida el importe con tu ticket: fotografíalo y lo leemos automáticamente."
          : "Introduce el importe del ticket. El negocio confirma y te aplican el descuento."}
      </Text>
      <View style={{ flexDirection: "row", alignItems: "flex-end", justifyContent: "center" }}>
        <TextInput
          style={[styles.bigInput, !amountEditable && { opacity: 0.4 }]}
          keyboardType="decimal-pad"
          placeholder="0,00"
          placeholderTextColor={c.grayLight}
          value={amount}
          onChangeText={setAmount}
          editable={amountEditable}
          autoFocus={!requireTicket}
        />
        <Text style={styles.bigSymbol}>€</Text>
      </View>

      {/* Escanear ticket con IA (obligatorio si el negocio lo exige) */}
      <TouchableOpacity
        style={[styles.ticketBtn, requireTicket && !ticketScanId && styles.ticketBtnPrimary]}
        onPress={() => setTicketMode("cam")}
        disabled={busy}
      >
        <Text style={[styles.ticketBtnText, requireTicket && !ticketScanId && styles.ticketBtnPrimaryText]}>
          {requireTicket && !ticketScanId
            ? "📷  Fotografiar el ticket (obligatorio)"
            : "📷  Escanear ticket y rellenar solo"}
        </Text>
      </TouchableOpacity>
      {!!ticketUrl && <Text style={styles.ticketOk}>✓ Ticket guardado</Text>}

      <TouchableOpacity
        style={[styles.btn, !canSubmit && { opacity: 0.5 }]}
        onPress={submit}
        disabled={!canSubmit}
      >
        <Text style={styles.btnText}>{busy ? "Enviando…" : "Confirmar"}</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.rescan} onPress={rescan} disabled={busy}>
        <Text style={styles.rescanText}>Escanear otro código</Text>
      </TouchableOpacity>
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    center: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: c.bg, gap: 12 },
    permIll: { width: 200, height: 200, marginBottom: 4 },
    muted: { color: c.gray, textAlign: "center", fontSize: 14, lineHeight: 20, paddingHorizontal: 24 },
    amountRoot: { flex: 1, padding: 24, backgroundColor: c.bg, paddingTop: 80, alignItems: "center" },
    bigTitle: { fontSize: 24, fontWeight: "900", color: c.black, textAlign: "center", letterSpacing: -0.5 },
    bigInput: { fontSize: 52, fontWeight: "900", color: c.black, borderBottomColor: c.pink, borderBottomWidth: 2, minWidth: 160, textAlign: "center" },
    bigSymbol: { fontSize: 32, fontWeight: "800", color: c.gray, marginLeft: 8, paddingBottom: 10 },
    btn: { marginTop: 32, backgroundColor: c.pink, borderRadius: radius.pill, paddingVertical: 15, paddingHorizontal: 32, ...shadow.btn },
    btnText: { color: c.onAccent, fontSize: 16, fontWeight: "800" },
    scanFrame: { position: "absolute", top: "30%", left: "15%", width: "70%", height: "30%", borderColor: c.pink, borderWidth: 3, borderRadius: 24 },
    overlayHint: { position: "absolute", bottom: 80, left: 0, right: 0, padding: 12 },
    overlayText: { color: "#FFF", textAlign: "center", fontSize: 15, fontWeight: "700" },
    topBar: { position: "absolute", left: 16, right: 16, flexDirection: "row", justifyContent: "space-between" },
    roundBtn: { height: 44, width: 44, borderRadius: 22, backgroundColor: "rgba(0,0,0,0.45)", alignItems: "center", justifyContent: "center" },
    roundBtnOn: { backgroundColor: c.pink },
    roundBtnText: { color: "#FFF", fontSize: 18, fontWeight: "800" },
    backRow: { position: "absolute", left: 16 },
    backText: { color: c.gray, fontSize: 16, fontWeight: "800" },
    rescan: { marginTop: 18, paddingVertical: 8 },
    rescanText: { color: c.pink, fontSize: 14, fontWeight: "800" },
    ticketBtn: { marginTop: 22, flexDirection: "row", alignItems: "center", justifyContent: "center", paddingVertical: 14, paddingHorizontal: 20, borderRadius: radius.pill, borderWidth: 2, borderColor: c.pink, backgroundColor: c.pinkWash },
    ticketBtnText: { color: c.pinkDeep, fontSize: 15, fontWeight: "800" },
    ticketBtnPrimary: { backgroundColor: c.pink, borderColor: c.pink },
    ticketBtnPrimaryText: { color: c.onAccent },
    ticketOk: { marginTop: 8, color: c.green, fontSize: 13, fontWeight: "800" },
    // Oferta-reto viral en la pantalla de éxito.
    challengeBox: { marginTop: 20, marginHorizontal: 8, padding: 16, borderRadius: radius.lg, borderWidth: 2, borderColor: c.pink, backgroundColor: c.pinkWash },
    challengeTitle: { fontSize: 16, fontWeight: "900", color: c.pinkDeep, textAlign: "center" },
    challengeText: { fontSize: 13, color: c.black, textAlign: "center", marginTop: 6, lineHeight: 19 },
    challengeStrong: { fontWeight: "900", color: c.pinkDeep },
    challengeShare: { marginTop: 12, backgroundColor: c.pink, borderRadius: radius.pill, paddingVertical: 13, alignItems: "center", ...shadow.btn },
    challengeShareText: { color: c.onAccent, fontSize: 15, fontWeight: "800" },
    ticketFrame: { position: "absolute", top: "16%", left: "10%", width: "80%", height: "56%", borderColor: "#FFF", borderWidth: 3, borderRadius: 18, borderStyle: "dashed" },
    shutter: { alignSelf: "center", marginTop: 16, backgroundColor: c.pink, borderRadius: radius.pill, paddingVertical: 14, paddingHorizontal: 36, ...shadow.btn },
    shutterText: { color: c.onAccent, fontSize: 16, fontWeight: "900" }
  });
