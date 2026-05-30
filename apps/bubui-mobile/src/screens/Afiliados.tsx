import { useCallback, useState } from "react";
import { View, StyleSheet, ActivityIndicator, Linking } from "react-native";
import { WebView } from "react-native-webview";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { CheckSession } from "../lib/session";
import { API_BASE } from "../lib/api";
import { BottomNav } from "../components/BottomNav";
import { useTheme, type Palette } from "../lib/theme";

export function Afiliados() {
  const nav = useNavigation<any>();
  const c = useTheme();
  const styles = makeStyles(c);
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
          source={{ uri: `${API_BASE}/bubui/app/afiliados?cid=${encodeURIComponent(cid)}` }}
          style={{ flex: 1, backgroundColor: c.bg }}
          onShouldStartLoadWithRequest={(req) => {
            const u = req.url;
            if (/^(whatsapp:|mailto:|tel:|sms:)/.test(u) || /wa\.me|api\.whatsapp\.com/.test(u)) {
              Linking.openURL(u).catch(() => {});
              return false;
            }
            return true;
          }}
          startInLoadingState
          renderLoading={() => (
            <View style={styles.loading}><ActivityIndicator color={c.pink} size="large" /></View>
          )}
        />
      ) : (
        <View style={styles.loading}><ActivityIndicator color={c.pink} size="large" /></View>
      )}
      <BottomNav active="Afiliados" />
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: c.bg, paddingTop: 44 },
    loading: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center", backgroundColor: c.bg }
  });
