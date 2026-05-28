import { useEffect, useState } from "react";
import { View, Text, StyleSheet, TextInput, TouchableOpacity, Alert } from "react-native";
import { CameraView, Camera } from "expo-camera";
import * as Location from "expo-location";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import { CheckSession } from "../lib/session";
import { api } from "../lib/api";
import { colors, radius, shadow } from "../lib/theme";
import type { RootStackParamList } from "../../App";

type ScanRoute = RouteProp<RootStackParamList, "Scan">;

export function Scan() {
  const nav = useNavigation<any>();
  const route = useRoute<ScanRoute>();
  const initialBusinessId = route.params?.businessId || "";

  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [businessId, setBusinessId] = useState<string>(initialBusinessId);
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<any>(null);

  useEffect(() => {
    (async () => {
      const { status } = await Camera.requestCameraPermissionsAsync();
      setHasPermission(status === "granted");
    })();
  }, []);

  function onScanned(result: { data: string }) {
    const m = /\/bipi\/scan\/([a-z0-9_-]+)/i.exec(result.data);
    if (m) {
      setBusinessId(m[1]);
    } else {
      Alert.alert("QR no reconocido", "Asegúrate de escanear un QR Bipi válido.");
    }
  }

  async function submit() {
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
    setBusy(true);
    try {
      let lat: number | undefined;
      let lng: number | undefined;
      try {
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        lat = loc.coords.latitude;
        lng = loc.coords.longitude;
      } catch {}
      const r = await api.scan(businessId, session.customerId, value, lat, lng);
      setDone(r);
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "No se pudo enviar el escaneo");
    } finally {
      setBusy(false);
    }
  }

  if (hasPermission === null) {
    return <View style={styles.center}><Text style={styles.muted}>Pidiendo permiso de cámara…</Text></View>;
  }
  if (hasPermission === false) {
    return <View style={styles.center}><Text style={styles.muted}>Sin permiso de cámara. Actívalo en ajustes.</Text></View>;
  }

  if (done) {
    const rejected = done.status === "rejected";
    return (
      <View style={[styles.center, { padding: 24 }]}>
        <Text style={{ fontSize: 64 }}>{rejected ? "❌" : "✅"}</Text>
        <Text style={styles.bigTitle}>{rejected ? "Escaneo no válido" : "Enviado al negocio"}</Text>
        <Text style={styles.muted}>
          {rejected
            ? done.rejectionReason
            : `En cuanto el negocio confirme el importe, te aplican el ${done.discountPct}% y desbloqueas nuevos cupones cerca.`}
        </Text>
        <TouchableOpacity style={styles.btn} onPress={() => nav.reset({ index: 0, routes: [{ name: "Feed" }] })}>
          <Text style={styles.btnText}>Ver mis cupones</Text>
        </TouchableOpacity>
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
        />
        {/* Marco visual de escaneo */}
        <View style={styles.scanFrame} pointerEvents="none" />
        <View style={styles.overlayHint}>
          <Text style={styles.overlayText}>Apunta al QR del negocio</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.amountRoot}>
      <Text style={styles.bigTitle}>¿Cuánto has pagado?</Text>
      <Text style={[styles.muted, { marginBottom: 24 }]}>
        Introduce el importe del ticket. El negocio confirma y te aplican el descuento.
      </Text>
      <View style={{ flexDirection: "row", alignItems: "flex-end", justifyContent: "center" }}>
        <TextInput
          style={styles.bigInput}
          keyboardType="decimal-pad"
          placeholder="0,00"
          placeholderTextColor={colors.grayLight}
          value={amount}
          onChangeText={setAmount}
          autoFocus
        />
        <Text style={styles.bigSymbol}>€</Text>
      </View>
      <TouchableOpacity style={[styles.btn, busy && { opacity: 0.5 }]} onPress={submit} disabled={busy}>
        <Text style={styles.btnText}>{busy ? "Enviando…" : "Confirmar"}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: colors.white, gap: 12 },
  muted: { color: colors.gray, textAlign: "center", fontSize: 14, lineHeight: 20, paddingHorizontal: 24 },
  amountRoot: { flex: 1, padding: 24, backgroundColor: colors.white, paddingTop: 80, alignItems: "center" },
  bigTitle: { fontSize: 24, fontWeight: "900", color: colors.black, textAlign: "center", letterSpacing: -0.5 },
  bigInput: { fontSize: 52, fontWeight: "900", color: colors.black, borderBottomColor: colors.pink, borderBottomWidth: 2, minWidth: 160, textAlign: "center" },
  bigSymbol: { fontSize: 32, fontWeight: "800", color: colors.gray, marginLeft: 8, paddingBottom: 10 },
  btn: { marginTop: 32, backgroundColor: colors.pink, borderRadius: radius.pill, paddingVertical: 15, paddingHorizontal: 32, ...shadow.btn },
  btnText: { color: colors.white, fontSize: 16, fontWeight: "800" },
  scanFrame: { position: "absolute", top: "30%", left: "15%", width: "70%", height: "30%", borderColor: colors.pink, borderWidth: 3, borderRadius: 24 },
  overlayHint: { position: "absolute", bottom: 80, left: 0, right: 0, padding: 12 },
  overlayText: { color: "#FFF", textAlign: "center", fontSize: 15, fontWeight: "700" }
});
