import { useRef, useState } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ScrollView, Platform, Image, FlatList, Dimensions, Linking } from "react-native";
import { useNavigation } from "@react-navigation/native";
import DateTimePicker from "@react-native-community/datetimepicker";
import * as Location from "expo-location";
import * as Notifications from "expo-notifications";
import { api } from "../lib/api";
import { saveSession } from "../lib/session";
import { Wordmark } from "../components/Wordmark";
import { colors, radius, shadow } from "../lib/theme";

function fmtDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function fmtDateHuman(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

// Pantallas de bienvenida = ilustraciones de marca (diseño Bubui).
type Slide = { image: any; cta: string };
const SLIDES: Slide[] = [
  { image: require("../../assets/onb-descuentos.png"), cta: "Siguiente" },
  { image: require("../../assets/onb-limpio.png"), cta: "Siguiente" },
  { image: require("../../assets/onb-barrio.png"), cta: "Crear mi cuenta" }
];

export function Onboarding() {
  const nav = useNavigation<any>();
  // Flujo: 0..2 = slides (carrusel) → 3 = pantalla "elige tipo" → 4 = signup cliente
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
        <View style={styles.topBar}>
          <Wordmark size={30} />
          <TouchableOpacity onPress={goSignup} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Text style={styles.skip}>Saltar</Text>
          </TouchableOpacity>
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
                <TouchableOpacity
                  activeOpacity={0.95}
                  onPress={advance}
                  style={{ width: bodyW, height: bodyH, alignItems: "center", justifyContent: "center" }}
                >
                  <Image source={item.image} style={{ width: bodyW, height: bodyH }} resizeMode="contain" />
                </TouchableOpacity>
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
          <TouchableOpacity style={styles.btn} onPress={advance} activeOpacity={0.9}>
            <Text style={styles.btnText}>{SLIDES[slideIndex].cta}</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // Pantalla intermedia: elegir entre alta de cliente o alta de negocio
  if (step === SLIDES.length) {
    return (
      <View style={styles.chooseRoot}>
        <View style={{ alignItems: "center", marginBottom: 28 }}>
          <Wordmark size={64} />
          <Text style={styles.tag}>Ahorra. Disfruta. Apoya local.</Text>
        </View>

        <Text style={styles.chooseHelp}>¿Qué quieres hacer?</Text>

        <TouchableOpacity style={styles.btn} onPress={() => setStep(SLIDES.length + 1)} activeOpacity={0.9}>
          <Text style={[styles.btnText, styles.btnTextSmall]}>DARME DE ALTA PARA OBTENER DESCUENTOS Y REGALOS</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.btn, styles.btnSecondary]}
          onPress={() => Linking.openURL("https://bubui.app/registro").catch(() => {})}
          activeOpacity={0.9}
        >
          <Text style={[styles.btnText, styles.btnTextSmall, styles.btnSecondaryText]}>DAR DE ALTA MI NEGOCIO</Text>
        </TouchableOpacity>
      </View>
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
            placeholderTextColor={colors.grayLight}
            value={name}
            onChangeText={setName}
            autoCapitalize="words"
          />
          <TextInput
            style={styles.input}
            placeholder="Teléfono móvil"
            placeholderTextColor={colors.grayLight}
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
          />
          <TextInput
            style={styles.input}
            placeholder="Email"
            placeholderTextColor={colors.grayLight}
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
            <Text style={{ fontSize: 16, color: birthDate ? colors.black : colors.grayLight }}>
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
                  borderColor: gender === g.v ? colors.pink : "#E5E7EB",
                  backgroundColor: gender === g.v ? colors.pink : colors.white
                }}
              >
                <Text style={{ fontSize: 13, fontWeight: "700", color: gender === g.v ? colors.white : colors.black }}>{g.l}</Text>
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
          <Text style={{ color: colors.gray, fontSize: 13, textAlign: "center" }}>
            Introduce el código SMS enviado a {phone}
          </Text>
          <TextInput
            style={[styles.input, { textAlign: "center", fontSize: 24, letterSpacing: 8, fontWeight: "800" }]}
            placeholder="••••••"
            placeholderTextColor={colors.grayLight}
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
            <Text style={{ color: colors.gray, fontSize: 12, textAlign: "center" }}>← Cambiar número o reenviar</Text>
          </TouchableOpacity>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingTop: 56, paddingHorizontal: 22, paddingBottom: 36, backgroundColor: colors.white },
  topBar: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  skip: { color: colors.gray, fontSize: 14, fontWeight: "700" },

  slideBody: { flex: 1, justifyContent: "center", alignItems: "center" },
  slideImage: { width: "100%", height: "100%" },

  // Footer
  footer: { gap: 18 },
  dots: { flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "rgba(0,0,0,0.15)" },
  dotActive: { width: 24, backgroundColor: colors.pink },
  btn: { backgroundColor: colors.pink, borderRadius: radius.pill, paddingVertical: 16, alignItems: "center", ...shadow.btn },
  btnText: { color: colors.white, fontWeight: "800", fontSize: 16 },

  // Pantalla intermedia "elige tipo"
  chooseRoot: { flex: 1, paddingTop: 100, paddingHorizontal: 24, paddingBottom: 40, backgroundColor: colors.white, gap: 14 },
  chooseHelp: { textAlign: "center", color: colors.gray, fontSize: 13, fontWeight: "700", marginBottom: 18 },
  btnSecondary: { backgroundColor: colors.white, borderWidth: 2, borderColor: colors.pink },
  btnSecondaryText: { color: colors.pink },
  btnTextSmall: { fontSize: 13, lineHeight: 17, textAlign: "center", paddingHorizontal: 6 },

  // Signup
  signupRoot: { paddingTop: 80, paddingHorizontal: 24, paddingBottom: 60, backgroundColor: colors.white, flexGrow: 1 },
  tag: { color: colors.black, textAlign: "center", fontSize: 15, fontWeight: "800", marginTop: 12 },
  card: { marginTop: 30, backgroundColor: colors.white, padding: 18, borderRadius: radius.xl, gap: 12, borderWidth: 1, borderColor: colors.border, ...shadow.card },
  input: { borderColor: "#E5E7EB", borderWidth: 2, borderRadius: radius.sm, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, backgroundColor: colors.white, color: colors.black },
  legal: { fontSize: 11, color: colors.gray, textAlign: "center", marginTop: 6, lineHeight: 16 }
});
