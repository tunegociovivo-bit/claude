import { View, StyleSheet, ActivityIndicator } from "react-native";
import { WebView } from "react-native-webview";
import { API_BASE } from "../lib/api";
import { BottomNav } from "../components/BottomNav";
import { colors } from "../lib/theme";

export function Mapa() {
  return (
    <View style={styles.root}>
      <WebView
        source={{ uri: `${API_BASE}/bubui/app/mapa` }}
        style={{ flex: 1 }}
        startInLoadingState
        renderLoading={() => (
          <View style={styles.loading}>
            <ActivityIndicator color={colors.pink} size="large" />
          </View>
        )}
      />
      <BottomNav active="Mapa" />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.white, paddingTop: 44 },
  loading: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center", backgroundColor: colors.white }
});
