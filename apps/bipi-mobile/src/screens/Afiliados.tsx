import { useCallback, useState } from "react";
import { View, StyleSheet, ActivityIndicator } from "react-native";
import { WebView } from "react-native-webview";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { CheckSession } from "../lib/session";
import { API_BASE } from "../lib/api";
import { BottomNav } from "../components/BottomNav";
import { colors } from "../lib/theme";

export function Afiliados() {
  const nav = useNavigation<any>();
  const [cid, setCid] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      (async () => {
        const s = await CheckSession();
        if (!s) { nav.reset({ index: 0, routes: [{ name: "Onboarding" }] }); return; }
        setCid(s.customerId);
      })();
    }, [nav])
  );

  return (
    <View style={styles.root}>
      {cid ? (
        <WebView
          source={{ uri: `${API_BASE}/bipi/app/afiliados?cid=${encodeURIComponent(cid)}` }}
          style={{ flex: 1 }}
          startInLoadingState
          renderLoading={() => (
            <View style={styles.loading}><ActivityIndicator color={colors.pink} size="large" /></View>
          )}
        />
      ) : (
        <View style={styles.loading}><ActivityIndicator color={colors.pink} size="large" /></View>
      )}
      <BottomNav active="Afiliados" />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.white, paddingTop: 44 },
  loading: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center", backgroundColor: colors.white }
});
