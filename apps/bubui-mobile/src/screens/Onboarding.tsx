import { useRef, useState } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ScrollView, Platform, Image, FlatList, Dimensions, Linking } from "react-native";
import { useNavigation } from "@react-navigation/native";
import DateTimePicker from "@react-native-community/datetimepicker";
import * as Location from "expo-location";
import * as Notifications from "expo-notifications";
import { api } from "../lib/api";
import { saveSession } from "../lib/session";
import { Wordmark } from "../components/Wordmark";
import { useTheme, type Palette, radius, shadow } from "../lib/theme";

function fmtDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function fmtDateHuman(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

// Pantallas de bienvenida — diseño del mockup oficial. El título lleva
// una parte rosa al final; la ilustración 3D va centrada.
type Slide = {
  image: any;
  titleStart: string; // parte en negro
  titleEnd: string;   // parte en rosa
  subtitle: string;
  cta: string;
};
const SLIDES: Slide[] = [
  {
    image: require("../../assets/ill-tienda.png"),
    titleStart: "Descubre ofertas",
    titleEnd: "cerca de ti",
    subtitle: "Ahorra en comercios locales\ncada vez que compras.",
    cta: "Empezar ahora"
  },
  {
    image: require("../../assets/ill-scan.png"),
    titleStart: "Compra en un",
    titleEnd: "negocio Bubui",
    subtitle: "Escanea el QR de caja y\ndesbloquea nuevos descuentos.",
    cta: "Siguiente"
  },
  {
    image: require("../../assets/ill-ruta.png"),
    titleStart: "Salta de comercio en",
    titleEnd: "comercio",
    subtitle: "Cuanto más compras local,\nmás beneficios recibes.",
    cta: "Empezar ahora"
  }
];

export function Onboarding() {
  const nav = useNavigation<any>();
  const c = useTheme();
  const styles = makeStyles(c);
  // Flujo: 0..2 = slides (carrusel) → 3 = pantalla "elige tipo" → 4 = signup cliente
  //        5 = login (solo teléfono + OTP)
  const [step, setStep] = useState(0);
  const [slideIndex, setSlideIndex] = useState(0);
  const [bodyW, setBodyW] = useState(0);
  const [bodyH, setBodyH] = useState(0);
  const listRef = useRef<FlatList>(null);
  const [otpStep, setOtpStep] = useState<"form" | "code">("form");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
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
        totalPurchases: r.totalPurchases ?? 0
      });
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
    if (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate.trim())) { Alert.alert("Fecha", "Usa el formato AAAA-MM-DD"); return; }
    if (!gender) { Alert.alert("Indica tu sexo"); return; }
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
      const r = await api.verifyOtp({
        phone: phone.trim(),
        code: code.trim(),
        name: name.trim(),
        email: email.trim(),
        birthDate: birthDate.trim(),
        gender
      });
      try { await Location.requestForegroundPermissionsAsync(); } catch {}
      try { await Notifications.requestPermissionsAsync(); } catch {}
      await saveSession({
        customerId: r.customerId,
        name: r.name,
        email: email.trim() || undefined,
        totalSaved: r.totalSaved ?? 0,
        totalPurchases: r.totalPurchases ?? 0
      });
      nav.reset({ index: 0, routes: [{ name: "Feed" }] });
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "Código incorrecto");
    } finally {
      setBusy(false);
    }
  }

  // Slides de intro: carrusel deslizable (swipe), tocando la imagen o con el botón.
  if (step < SLIDES.length) {
    const goSignup = () => setStep(SLIDES.length);
    const advance = () => {
      if (slideIndex < SLIDES.length - 1) {
        const next = slideIndex + 1;
        setSlideIndex(next);
        listRef.current?.scrollToOffset({ offset: next * bodyW, animated: true });
      } else {
        goSignup();
      }
    };
    return (
      <View style={styles.root}>
        <View style={styles.brandRow}>
          <Wordmark size={56} />
        </View>

        <View
          style={styles.slideBody}
          onLayout={(e) => {
            setBodyW(e.nativeEvent.layout.width);
            setBodyH(e.nativeEvent.layout.height);
          }}
        >
          {bodyW > 0 && bodyH > 0 && (
            <FlatList
              ref={listRef}
              data={SLIDES}
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              keyExtractor={(_, i) => String(i)}
              style={{ width: bodyW, height: bodyH }}
              getItemLayout={(_, i) => ({ length: bodyW, offset: bodyW * i, index: i })}
              onMomentumScrollEnd={(e) => setSlideIndex(Math.round(e.nativeEvent.contentOffset.x / bodyW))}
              renderItem={({ item }) => (
                <View style={{ width: bodyW, height: bodyH, alignItems: "center" }}>
                  <Text style={styles.slideTitle}>
                    {item.titleStart}{"\n"}
                    <Text style={styles.slideTitleAccent}>{item.titleEnd}</Text>
                  </Text>
                  <Text style={styles.slideSubtitle}>{item.subtitle}</Text>
                  <View style={styles.slideIllustrationWrap}>
                    <Image source={item.image} style={styles.slideIllustration} resizeMode="contain" />
                  </View>
                </View>
              )}
            />
          )}
        </View>

        <View style={styles.footer}>
          <View style={styles.dots}>
            {SLIDES.map((_, i) => (
              <View key={i} style={[styles.dot, i === slideIndex && styles.dotActive]} />
            ))}
          </View>
          <TouchableOpacity style={styles.ctaBtn} onPress={advance} activeOpacity={0.9}>
            <Text style={styles.ctaBtnText}>{SLIDES[slideIndex].cta}</Text>
            <View style={styles.ctaArrowCircle}>
              <Text style={styles.ctaArrow}>→</Text>
            </View>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // Pantalla intermedia: elegir entre alta de cliente o alta de negocio
  if (step === SLIDES.length) {
    return (
      <View style={styles.chooseRoot}>
        <View style={styles.chooseHeader}>
          <Wordmark size={56} />
          <Text style={styles.tag}>Ahorra. Disfruta. Apoya local.</Text>
        </View>

        {/* CTA principal: tarjeta hero para alta de cliente */}
        <TouchableOpacity
          style={styles.heroCard}
          onPress={() => setStep(SLIDES.length + 1)}
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
          onPress={() => { setStep(SLIDES.length + 2); setLoginStep("phone"); setPhone(""); setCode(""); }}
          activeOpacity={0.7}
        >
          <Text style={styles.loginLinkText}>
            ¿Ya tienes cuenta? <Text style={styles.loginLinkStrong}>Inicia sesión</Text>
          </Text>
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
  if (step === SLIDES.length + 2) {
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
            <TouchableOpacity onPress={() => setStep(SLIDES.length)}>
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
          <TouchableOpacity
            style={styles.input}
            onPress={() => setShowDatePicker(true)}
            activeOpacity={0.7}
          >
            <Text style={{ fontSize: 16, color: birthDate ? c.black : c.grayLight }}>
              {birthDate ? `📅  ${fmtDateHuman(birthDate)}` : "Fecha de nacimiento"}
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
