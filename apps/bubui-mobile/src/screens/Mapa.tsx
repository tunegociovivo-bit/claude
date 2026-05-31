import { View, StyleSheet, ActivityIndicator } from "react-native";
import { WebView } from "react-native-webview";
import { API_BASE } from "../lib/api";
import { BottomNav } from "../components/BottomNav";
import { FadeIn } from "../components/FadeIn";
import { useTheme, type Palette } from "../lib/theme";

export function Mapa() {
  const c = useTheme();
  const styles = makeStyles(c);
  return (
    <View style={styles.root}>
      <FadeIn replayOnFocus dy={0} style={{ flex: 1 }}>
        <WebView
          source={{ uri: `${API_BASE}/bubui/app/mapa` }}
          style={{ flex: 1, backgroundColor: c.bg }}
          startInLoadingState
          renderLoading={() => (
            <View style={styles.loading}>
              <ActivityIndicator color={c.pink} size="large" />
            </View>
          )}
        />
      </FadeIn>
      <BottomNav active="Mapa" />
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: c.bg, paddingTop: 44 },
    loading: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center", backgroundColor: c.bg }
  });
