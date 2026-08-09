import { useState, useEffect, useRef } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ScrollView, Platform, Image, Linking, Animated, Easing } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Bouncy } from "../components/Bouncy";
import { sfx } from "../lib/sound";
import { useNavigation, useRoute } from "@react-navigation/native";
import DateTimePicker from "@react-native-community/datetimepicker";
import * as Location from "expo-location";
import * as Notifications from "expo-notifications";
import { api } from "../lib/api";
import { saveSession } from "../lib/session";
import { getPendingRef, applyPendingRef, waitForReferrerCapture } from "../lib/referral-pending";
import { claimPendingDeal } from "../lib/deal-pending";
import { Wordmark } from "../components/Wordmark";
import { useTheme, type Palette, radius, shadow } from "../lib/theme";
import { Video, ResizeMode } from "expo-av";
import { onboardingVideoSource } from "../lib/onboardingVideo";

function fmtDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function fmtDateHuman(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

// Pantalla de bienvenida: un único vídeo de presentación que explica cómo usar
// la app (sustituye al antiguo carrusel de 3 ilustraciones). Tras el vídeo, el
// CTA lleva a elegir tipo de alta. INTRO_STEP_COUNT = nº de pantallas de intro
// previas a "elegir tipo" (ahora 1). Los pasos posteriores se anclan a él.
const INTRO_STEP_COUNT = 1;

export function Onboarding() {
  const nav = useNavigation<any>();
  const route = useRoute<any>();
  const insets = useSafeAreaInsets();
  const c = useTheme();
  const styles = makeStyles(c);
  // Flujo: 0 = vídeo de intro → 1 = pantalla "elige tipo" → 2 = signup cliente
  //        3 = login (solo teléfono + OTP)
  // Si se entra con `start: "register"` (p. ej. invitado pulsando "Cuenta"),
  // saltamos el vídeo y vamos directos a la pantalla de registro.
  const [step, setStep] = useState(route.params?.start === "register" ? INTRO_STEP_COUNT : 0);
  // Animación de "latido" para llamar la atención sobre el CTA "Empezar ahora".
  const ctaPulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(ctaPulse, { toValue: 1.06, duration: 850, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(ctaPulse, { toValue: 1, duration: 850, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [ctaPulse]);
  const [bodyW, setBodyW] = useState(0);
  const [bodyH, setBodyH] = useState(0);
  const [otpStep, setOtpStep] = useState<"form" | "code">("form");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [gender, setGender] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  // Login (solo teléfono): reutiliza phone/code de arriba, pero el sub-paso es independiente.
  const [loginStep, setLoginStep] = useState<"phone" | "code">("phone");

  async function loginRequestCode() {
    if (phone.trim().length < 6) { Alert.alert("Teléfono inválido"); return; }
    setBusy(true);
    try {
      await api.requestOtp(phone.trim());
      setLoginStep("code");
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "No se pudo enviar el código");
    } finally {
      setBusy(false);
    }
  }

  async function loginVerify() {
    setBusy(true);
    try {
      const r = await api.login(phone.trim(), code.trim());
      await saveSession({
        customerId: r.customerId,
        name: r.name ?? undefined,
        totalSaved: r.totalSaved ?? 0,
        totalPurchases: r.totalPurchases ?? 0,
        token: r.token
      });
      void claimPendingDeal(r.customerId); // reclama el reto si venía de un enlace
      sfx.tap();
      nav.reset({ index: 0, routes: [{ name: "Feed" }] });
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "No se pudo iniciar sesión");
    } finally {
      setBusy(false);
    }
  }

  async function sendCode() {
    if (!name.trim()) { Alert.alert("Pon tu nombre"); return; }
    if (phone.trim().length < 6) { Alert.alert("Teléfono inválido"); return; }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) { Alert.alert("Email inválido"); return; }
    // En iOS, código postal / fecha de nacimiento / sexo son OPCIONALES (lo exige
    // Apple, guideline 5.1.1(v)). En Android se mantienen OBLIGATORIOS.
    // Si se rellenan, validamos el formato en ambas plataformas.
    const requirePersonal = Platform.OS !== "ios";
    if (postalCode.trim() && !/^\d{5}$/.test(postalCode.trim())) { Alert.alert("Código postal", "Debe tener 5 dígitos"); return; }
    if (requirePersonal && !/^\d{5}$/.test(postalCode.trim())) { Alert.alert("Código postal", "Indica tu código postal (5 dígitos)"); return; }
    if (birthDate.trim() && !/^\d{4}-\d{2}-\d{2}$/.test(birthDate.trim())) { Alert.alert("Fecha", "Usa el formato AAAA-MM-DD"); return; }
    if (requirePersonal && !/^\d{4}-\d{2}-\d{2}$/.test(birthDate.trim())) { Alert.alert("Fecha", "Indica tu fecha de nacimiento"); return; }
    if (requirePersonal && !gender) { Alert.alert("Indica tu sexo"); return; }
    setBusy(true);
    try {
      await api.requestOtp(phone.trim());
      setOtpStep("code");
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "No se pudo enviar el código");
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    setBusy(true);
    try {
      // Espera ACOTADA (≤2,5s) a que la captura del Install Referrer termine
      // antes de concluir que no hay código — cierra la carrera captura/alta.
      await waitForReferrerCapture();
      const ref = (await getPendingRef()) ?? undefined;
      const r = await api.verifyOtp({
        phone: phone.trim(),
        code: code.trim(),
        name: name.trim(),
        email: email.trim(),
        birthDate: birthDate.trim(),
        gender,
        postalCode: postalCode.trim(),
        ref
      });
      // OJO: NO limpiamos el ref pendiente aquí — la vinculación de
      // verify-otp puede fallar silenciosamente en el servidor. El Feed
      // reintenta con applyPendingRef (idempotente) y limpia al confirmar.
      void applyPendingRef(r.customerId);
      void claimPendingDeal(r.customerId); // reclama el reto si venía de un enlace
      try { await Location.requestForegroundPermissionsAsync(); } catch {}
      try { await Notifications.requestPermissionsAsync(); } catch {}
      await saveSession({
        customerId: r.customerId,
        name: r.name,
        email: email.trim() || undefined,
        totalSaved: r.totalSaved ?? 0,
        totalPurchases: r.totalPurchases ?? 0,
        token: r.token
      });
      sfx.success();
      nav.reset({ index: 0, routes: [{ name: "Feed" }] });
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "Código incorrecto");
    } finally {
      setBusy(false);
    }
  }

  // Intro: vídeo de presentación que explica cómo usar la app.
  if (step < INTRO_STEP_COUNT) {
    const goSignup = () => {
      sfx.tap();
      setStep(INTRO_STEP_COUNT);
    };
    const videoSource = onboardingVideoSource();
    return (
      <View style={[styles.root, { paddingBottom: Math.max(insets.bottom, 16) + 16 }]}>
        <View style={styles.brandRow}>
          <Wordmark size={56} />
        </View>

        <View
          style={[styles.slideBody, { marginBottom: 22 }]}
          onLayout={(e) => {
            setBodyW(e.nativeEvent.layout.width);
            setBodyH(e.nativeEvent.layout.height);
          }}
        >
          {bodyW > 0 && bodyH > 0 && (
            videoSource ? (
              // Wrapper con esquinas redondeadas + overflow hidden para recortar
              // el vídeo (COVER llena el marco sin franjas negras).
              <View style={{ width: bodyW, height: bodyH, borderRadius: radius.lg, overflow: "hidden", backgroundColor: c.bg }}>
                <Video
                  source={videoSource}
                  style={{ width: bodyW, height: bodyH }}
                  resizeMode={ResizeMode.COVER}
                  shouldPlay
                  isLooping={false}
                  onPlaybackStatusUpdate={(st) => {
                    // Al terminar el vídeo, llevar directo a la pantalla de registro.
                    if ("didJustFinish" in st && st.didJustFinish) setStep(INTRO_STEP_COUNT);
                  }}
                />
              </View>
            ) : (
              <View style={{ width: bodyW, height: bodyH, alignItems: "center", justifyContent: "center" }}>
                <Text style={styles.slideSubtitle}>El vídeo de presentación se está preparando.</Text>
              </View>
            )
          )}
        </View>

        <View style={styles.footer}>
          <Animated.View style={{ transform: [{ scale: ctaPulse }] }}>
            <Bouncy style={styles.ctaBtn} onPress={goSignup}>
              <Text style={styles.ctaBtnText}>Empezar ahora</Text>
              <View style={styles.ctaArrowCircle}>
                <Text style={styles.ctaArrow}>→</Text>
              </View>
            </Bouncy>
          </Animated.View>
        </View>
      </View>
    );
  }

  // Pantalla intermedia: elegir entre alta de cliente o alta de negocio
  if (step === INTRO_STEP_COUNT) {
    return (
      <View style={styles.chooseRoot}>
        <View style={styles.chooseHeader}>
          <Wordmark size={56} />
          <Text style={styles.tag}>Ahorra. Disfruta. Apoya local.</Text>
        </View>

        {/* CTA principal: tarjeta hero para alta de cliente */}
        <TouchableOpacity
          style={styles.heroCard}
          onPress={() => setStep(INTRO_STEP_COUNT + 1)}
          activeOpacity={0.92}
        >
          <View style={styles.heroIconWrap}>
            <Image source={require("../../assets/ill-cupon.png")} style={styles.heroIconImg} resizeMode="contain" />
          </View>
          <Text style={styles.heroTitle}>Descuentos y regalos{"\n"}cerca de ti</Text>
          <Text style={styles.heroSubtitle}>
            Crea tu cuenta gratis y empieza a ahorrar en bares, peluquerías, tiendas y mucho más de tu barrio.
          </Text>
          <View style={styles.heroPill}>
            <Text style={styles.heroPillText}>CREAR MI CUENTA GRATIS</Text>
          </View>
          <Text style={styles.heroFinePrint}>Sin tarjetas · Sin spam · 30 segundos</Text>
        </TouchableOpacity>

        {/* Link discreto a iniciar sesión (para quien ya tiene cuenta) */}
        <TouchableOpacity
          style={styles.loginLink}
          onPress={() => { setStep(INTRO_STEP_COUNT + 2); setLoginStep("phone"); setPhone(""); setCode(""); }}
          activeOpacity={0.7}
        >
          <Text style={styles.loginLinkText}>
            ¿Ya tienes cuenta? <Text style={styles.loginLinkStrong}>Inicia sesión</Text>
          </Text>
        </TouchableOpacity>

        {/* Explorar sin registrarse: ver negocios y ofertas del mapa sin cuenta.
            El registro solo se pide al canjear/escanear o guardar (Apple 5.1.1). */}
        <TouchableOpacity
          style={styles.guestBtn}
          onPress={() => { sfx.tap(); nav.reset({ index: 0, routes: [{ name: "Feed" }] }); }}
          activeOpacity={0.8}
        >
          <Text style={styles.guestBtnText}>Explorar sin cuenta</Text>
        </TouchableOpacity>

        {/* CTA secundaria: alta de negocio */}
        <View style={styles.bizRow}>
          <View style={styles.divider} />
          <Text style={styles.bizLead}>¿Tienes un negocio?</Text>
          <View style={styles.divider} />
        </View>
        <TouchableOpacity
          style={styles.bizBtn}
          onPress={() => Linking.openURL("https://bubui.app/registro").catch(() => {})}
          activeOpacity={0.8}
        >
          <Text style={styles.bizBtnText}>Dar de alta mi negocio  →</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // Pantalla de inicio de sesión (sólo teléfono + OTP)
  if (step === INTRO_STEP_COUNT + 2) {
    return (
      <ScrollView contentContainerStyle={styles.signupRoot}>
        <View style={{ alignItems: "center" }}>
          <Wordmark size={56} />
          <Text style={styles.tag}>Bienvenido de vuelta</Text>
        </View>

        {loginStep === "phone" ? (
          <View style={styles.card}>
            <Text style={{ color: c.gray, fontSize: 13, textAlign: "center", marginBottom: 4 }}>
              Introduce el teléfono de tu cuenta y te enviaremos un código por SMS.
            </Text>
            <TextInput
              style={styles.input}
              placeholder="Teléfono móvil"
              placeholderTextColor={c.grayLight}
              value={phone}
              onChangeText={setPhone}
              keyboardType="phone-pad"
              autoFocus
            />
            <TouchableOpacity
              style={[styles.btn, busy && { opacity: 0.5 }]}
              onPress={loginRequestCode}
              disabled={busy}
              activeOpacity={0.9}
            >
              <Text style={styles.btnText}>{busy ? "Enviando…" : "Enviar código SMS"}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setStep(INTRO_STEP_COUNT)}>
              <Text style={{ color: c.gray, fontSize: 12, textAlign: "center" }}>← Volver</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.card}>
            <Text style={{ color: c.gray, fontSize: 13, textAlign: "center" }}>
              Código SMS enviado a {phone}
            </Text>
            <TextInput
              style={[styles.input, { textAlign: "center", fontSize: 24, letterSpacing: 8, fontWeight: "800" }]}
              placeholder="••••••"
              placeholderTextColor={c.grayLight}
              value={code}
              onChangeText={(t) => setCode(t.replace(/[^0-9]/g, "").slice(0, 8))}
              keyboardType="number-pad"
              autoFocus
              autoComplete="sms-otp"
              textContentType="oneTimeCode"
              importantForAutofill="yes"
            />
            <TouchableOpacity
              style={[styles.btn, (busy || code.length < 4) && { opacity: 0.5 }]}
              onPress={loginVerify}
              disabled={busy || code.length < 4}
              activeOpacity={0.9}
            >
              <Text style={styles.btnText}>{busy ? "Verificando…" : "Entrar"}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => { setLoginStep("phone"); setCode(""); }}>
              <Text style={{ color: c.gray, fontSize: 12, textAlign: "center" }}>← Cambiar número o reenviar</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    );
  }

  // Signup con verificación por teléfono
  return (
    <ScrollView contentContainerStyle={styles.signupRoot}>
      <View style={{ alignItems: "center" }}>
        <Wordmark size={64} />
        <Text style={styles.tag}>Ahorra. Disfruta. Apoya local.</Text>
      </View>

      {otpStep === "form" ? (
        <View style={styles.card}>
          <TextInput
            style={styles.input}
            placeholder="Tu nombre"
            placeholderTextColor={c.grayLight}
            value={name}
            onChangeText={setName}
            autoCapitalize="words"
          />
          <TextInput
            style={styles.input}
            placeholder="Teléfono móvil"
            placeholderTextColor={c.grayLight}
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
          />
          <TextInput
            style={styles.input}
            placeholder="Email"
            placeholderTextColor={c.grayLight}
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
          />
          <TextInput
            style={styles.input}
            placeholder={Platform.OS === "ios" ? "Código postal (opcional)" : "Código postal"}
            placeholderTextColor={c.grayLight}
            value={postalCode}
            onChangeText={(t) => setPostalCode(t.replace(/[^0-9]/g, "").slice(0, 5))}
            keyboardType="number-pad"
            maxLength={5}
          />
          <TouchableOpacity
            style={styles.input}
            onPress={() => setShowDatePicker(true)}
            activeOpacity={0.7}
          >
            <Text style={{ fontSize: 16, color: birthDate ? c.black : c.grayLight }}>
              {birthDate ? `📅  ${fmtDateHuman(birthDate)}` : (Platform.OS === "ios" ? "Fecha de nacimiento (opcional)" : "Fecha de nacimiento")}
            </Text>
          </TouchableOpacity>
          {showDatePicker && (
            <DateTimePicker
              value={birthDate ? new Date(birthDate) : new Date(1995, 0, 1)}
              mode="date"
              display={Platform.OS === "ios" ? "spinner" : "calendar"}
              maximumDate={new Date()}
              minimumDate={new Date(1920, 0, 1)}
              onChange={(event, date) => {
                setShowDatePicker(Platform.OS === "ios");
                if (event.type === "set" && date) setBirthDate(fmtDate(date));
              }}
            />
          )}
          {Platform.OS === "ios" && (
            <Text style={{ fontSize: 12, color: c.grayLight, marginTop: -2 }}>
              Sexo (opcional)
            </Text>
          )}
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {[
              { v: "female", l: "Mujer" },
              { v: "male", l: "Hombre" },
              { v: "other", l: "Otro" },
              { v: "prefer_not", l: "Prefiero no decirlo" }
            ].map((g) => (
              <TouchableOpacity
                key={g.v}
                onPress={() => setGender(g.v)}
                style={{
                  paddingVertical: 8,
                  paddingHorizontal: 14,
                  borderRadius: 999,
                  borderWidth: 1.5,
                  borderColor: gender === g.v ? c.pink : c.border,
                  backgroundColor: gender === g.v ? c.pink : c.white
                }}
              >
                <Text style={{ fontSize: 13, fontWeight: "700", color: gender === g.v ? c.onAccent : c.black }}>{g.l}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <TouchableOpacity style={[styles.btn, busy && { opacity: 0.5 }]} onPress={sendCode} disabled={busy} activeOpacity={0.9}>
            <Text style={styles.btnText}>{busy ? "Enviando…" : "Enviar código SMS"}</Text>
          </TouchableOpacity>
          <Text style={styles.legal}>
            Te enviaremos un SMS con un código para verificar tu número. Sin tarjetas, sin spam.
          </Text>
        </View>
      ) : (
        <View style={styles.card}>
          <Text style={{ color: c.gray, fontSize: 13, textAlign: "center" }}>
            Introduce el código SMS enviado a {phone}
          </Text>
          <TextInput
            style={[styles.input, { textAlign: "center", fontSize: 24, letterSpacing: 8, fontWeight: "800" }]}
            placeholder="••••••"
            placeholderTextColor={c.grayLight}
            value={code}
            onChangeText={(t) => setCode(t.replace(/[^0-9]/g, "").slice(0, 8))}
            keyboardType="number-pad"
            autoFocus
            autoComplete="sms-otp"
            textContentType="oneTimeCode"
            importantForAutofill="yes"
          />
          <TouchableOpacity style={[styles.btn, (busy || code.length < 4) && { opacity: 0.5 }]} onPress={verify} disabled={busy || code.length < 4} activeOpacity={0.9}>
            <Text style={styles.btnText}>{busy ? "Verificando…" : "Verificar y entrar"}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => { setOtpStep("form"); setCode(""); }}>
            <Text style={{ color: c.gray, fontSize: 12, textAlign: "center" }}>← Cambiar número o reenviar</Text>
          </TouchableOpacity>
        </View>
      )}
    </ScrollView>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    root: { flex: 1, paddingTop: 56, paddingHorizontal: 22, paddingBottom: 36, backgroundColor: c.bg },
    topBar: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },

    // Brand + slide body — diseño del mockup oficial.
    brandRow: { alignItems: "center", paddingTop: 8, paddingBottom: 16 },
    slideBody: { flex: 1, justifyContent: "flex-start", alignItems: "center" },
    slideImage: { width: "100%", height: "100%" },
    slideTitle: {
      fontSize: 30,
      lineHeight: 36,
      fontWeight: "900",
      color: c.black,
      textAlign: "center",
      letterSpacing: -0.6,
      marginTop: 8
    },
    slideTitleAccent: { color: c.pink },
    slideSubtitle: {
      marginTop: 12,
      fontSize: 14,
      lineHeight: 20,
      color: c.gray,
      fontWeight: "500",
      textAlign: "center"
    },
    slideIllustrationWrap: {
      flex: 1,
      width: "100%",
      alignItems: "center",
      justifyContent: "center",
      marginTop: 16
    },
    slideIllustration: { width: "100%", height: "100%" },

    // Footer — dots + botón CTA con flecha en círculo blanco.
    footer: { gap: 18 },
    dots: { flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 6 },
    dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: c.border },
    dotActive: { width: 24, backgroundColor: c.pink },

    // CTA principal del slide: pill rosa con flecha en círculo blanco a la derecha.
    ctaBtn: {
      backgroundColor: c.pink,
      borderRadius: radius.pill,
      paddingVertical: 16,
      paddingHorizontal: 28,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      ...shadow.btn
    },
    ctaBtnText: {
      color: c.onAccent,
      fontWeight: "800",
      fontSize: 17,
      flex: 1,
      textAlign: "center"
    },
    ctaArrowCircle: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: c.white,
      alignItems: "center",
      justifyContent: "center"
    },
    ctaArrow: { color: c.pink, fontSize: 18, fontWeight: "900", marginTop: -2 },

    // Compat alias (en uso por el resto de pantallas).
    btn: { backgroundColor: c.pink, borderRadius: radius.pill, paddingVertical: 16, alignItems: "center", ...shadow.btn },
    btnText: { color: c.onAccent, fontWeight: "800", fontSize: 16 },
    skip: { color: c.gray, fontSize: 14, fontWeight: "700" },

    // Pantalla intermedia "elige tipo" — rediseño con jerarquía: hero card cliente + link secundario negocio
    chooseRoot: { flex: 1, paddingTop: 64, paddingHorizontal: 22, paddingBottom: 28, backgroundColor: c.bg },
    chooseHeader: { alignItems: "center", marginBottom: 28 },

    // Tarjeta hero (cliente) — la acción principal
    heroCard: {
      backgroundColor: c.pink,
      borderRadius: radius.xl,
      paddingTop: 28,
      paddingBottom: 22,
      paddingHorizontal: 22,
      alignItems: "center",
      shadowColor: c.pink,
      shadowOpacity: 0.35,
      shadowRadius: 22,
      shadowOffset: { width: 0, height: 12 },
      elevation: 14
    },
    heroIconWrap: {
      width: 110, height: 110, borderRadius: 55,
      backgroundColor: "rgba(255,255,255,0.16)",
      alignItems: "center", justifyContent: "center",
      marginBottom: 16
    },
    heroIconImg: { width: 86, height: 86 },
    heroIcon: { fontSize: 44, lineHeight: 50 },
    heroTitle: {
      color: c.onAccent,
      fontSize: 24,
      lineHeight: 28,
      fontWeight: "900",
      textAlign: "center",
      letterSpacing: -0.5
    },
    heroSubtitle: {
      color: "rgba(255,255,255,0.92)",
      fontSize: 14,
      lineHeight: 19,
      textAlign: "center",
      marginTop: 10,
      marginBottom: 22,
      paddingHorizontal: 4
    },
    heroPill: {
      backgroundColor: c.white,
      borderRadius: radius.pill,
      paddingVertical: 14,
      paddingHorizontal: 22,
      alignSelf: "stretch",
      alignItems: "center"
    },
    heroPillText: {
      color: c.pink,
      fontWeight: "900",
      fontSize: 14,
      letterSpacing: 0.4
    },
    heroFinePrint: {
      color: "rgba(255,255,255,0.85)",
      fontSize: 11,
      fontWeight: "700",
      marginTop: 12,
      letterSpacing: 0.2
    },

    // Link "Ya tengo cuenta" — entre el hero y el bloque negocio
    loginLink: { alignSelf: "center", paddingVertical: 14, paddingHorizontal: 18, marginTop: 8 },
    guestBtn: { alignSelf: "stretch", marginTop: 10, paddingVertical: 14, borderRadius: 14, borderWidth: 1.5, borderColor: c.pink, alignItems: "center" },
    guestBtnText: { fontSize: 15, fontWeight: "800", color: c.pink },
    loginLinkText: { fontSize: 14, color: c.gray, fontWeight: "600" },
    loginLinkStrong: { color: c.pink, fontWeight: "800" },

    // Bloque inferior — negocio (secundario)
    bizRow: { flexDirection: "row", alignItems: "center", marginTop: 30, marginBottom: 12, gap: 10 },
    divider: { flex: 1, height: 1, backgroundColor: c.border },
    bizLead: { fontSize: 11, color: c.gray, fontWeight: "800", letterSpacing: 0.8, textTransform: "uppercase" },
    bizBtn: {
      alignSelf: "center",
      paddingVertical: 12,
      paddingHorizontal: 18
    },
    bizBtnText: {
      color: c.pink,
      fontWeight: "800",
      fontSize: 14,
      letterSpacing: 0.2
    },

    // Signup
    signupRoot: { paddingTop: 80, paddingHorizontal: 24, paddingBottom: 60, backgroundColor: c.bg, flexGrow: 1 },
    tag: { color: c.black, textAlign: "center", fontSize: 15, fontWeight: "800", marginTop: 12 },
    card: { marginTop: 30, backgroundColor: c.white, padding: 18, borderRadius: radius.xl, gap: 12, borderWidth: 1, borderColor: c.border, ...shadow.card },
    input: { borderColor: c.border, borderWidth: 2, borderRadius: radius.sm, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, backgroundColor: c.white, color: c.black },
    legal: { fontSize: 11, color: c.gray, textAlign: "center", marginTop: 6, lineHeight: 16 }
  });
