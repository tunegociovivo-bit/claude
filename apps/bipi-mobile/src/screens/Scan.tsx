import { useEffect, useState } from "react";
import { View, Text, StyleSheet, TextInput, TouchableOpacity, Alert } from "react-native";
import { CameraView, Camera } from "expo-camera";
import * as Location from "expo-location";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import { CheckSession } from "../lib/session";
import { api } from "../lib/api";
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
    // Esperamos URLs del estilo https://hub.negociovivo.app/bipi/scan/<businessId>
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
    return <View style={styles.center}><Text>Pidiendo permiso de cámara…</Text></View>;
  }
  if (hasPermission === false) {
    return <View style={styles.center}><Text>Sin permiso de cámara. Actívalo en ajustes.</Text></View>;
  }

  if (done) {
    return (
      <View style={[styles.center, { padding: 24 }]}>
        {done.status === "rejected" ? (
          <>
            <Text style={{ fontSize: 64 }}>❌</Text>
            <Text style={styles.bigTitle}>Escaneo no válido</Text>
            <Text style={{ textAlign: "center", color: "#7A5C3E", marginVertical: 12 }}>
              {done.rejectionReason}
            </Text>
          </>
        ) : (
          <>
            <Text style={{ fontSize: 64 }}>✅</Text>
            <Text style={styles.bigTitle}>Enviado al negocio</Text>
            <Text style={{ textAlign: "center", color: "#7A5C3E", marginVertical: 12 }}>
              En cuanto confirme el importe, te aplican el {done.discountPct}% y desbloqueas nuevos cupones cerca.
            </Text>
          </>
        )}
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
        <View style={styles.overlayHint}>
          <Text style={{ color: "#FFF", textAlign: "center" }}>Apunta al QR del negocio</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.amountRoot}>
      <Text style={styles.bigTitle}>¿Cuánto has pagado?</Text>
      <Text style={{ color: "#7A5C3E", marginBottom: 24, textAlign: "center" }}>
        Introduce el importe del ticket. El negocio confirma y te aplican el descuento.
      </Text>
      <View style={{ flexDirection: "row", alignItems: "flex-end", justifyContent: "center" }}>
        <TextInput
          style={styles.bigInput}
          keyboardType="decimal-pad"
          placeholder="0,00"
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
  center: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#FDF2E1" },
  amountRoot: { flex: 1, padding: 24, backgroundColor: "#FDF2E1", paddingTop: 80, alignItems: "center" },
  bigTitle: { fontSize: 24, fontWeight: "800", color: "#3D2A1B", textAlign: "center" },
  bigInput: { fontSize: 48, fontWeight: "900", color: "#3D2A1B", borderBottomColor: "#C8612C", borderBottomWidth: 2, minWidth: 160, textAlign: "center" },
  bigSymbol: { fontSize: 32, fontWeight: "800", color: "#7A5C3E", marginLeft: 8, paddingBottom: 8 },
  btn: { marginTop: 32, backgroundColor: "#C8612C", borderRadius: 999, paddingVertical: 14, paddingHorizontal: 28 },
  btnText: { color: "#FFF", fontSize: 16, fontWeight: "700" },
  overlayHint: { position: "absolute", bottom: 60, left: 0, right: 0, padding: 12 }
});
