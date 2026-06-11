import { View, StyleSheet, ActivityIndicator } from "react-native";
import { WebView } from "react-native-webview";
import { API_BASE } from "../lib/api";
import { BottomNav } from "../components/BottomNav";
import { FadeIn } from "../components/FadeIn";
import { useTheme, type Palette } from "../lib/theme";

// La web oculta su cabecera/menú/instalar (clase bubui-embedded) cuando se
// carga dentro de la app, para no duplicar la navegación nativa. Se lo
// señalamos por tres vías (la web acepta cualquiera): el bridge
// ReactNativeWebView (requiere onMessage), el parámetro ?embed=1 y este JS.
const EMBED_JS =
  "try{document.body.classList.add('bubui-embedded');sessionStorage.setItem('bubuiEmbed','1');}catch(e){};true;";

export function Mapa() {
  const c = useTheme();
  const styles = makeStyles(c);
  return (
    <View style={styles.root}>
      <FadeIn replayOnFocus dy={0} style={{ flex: 1 }}>
        <WebView
          source={{ uri: `${API_BASE}/bubui/app/mapa?embed=1` }}
          style={{ flex: 1, backgroundColor: c.bg }}
          startInLoadingState
          injectedJavaScript={EMBED_JS}
          // onMessage hace que react-native-webview inyecte el bridge
          // window.ReactNativeWebView, que la web usa para detectar el embed.
          onMessage={() => {}}
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
