import { View, Text, StyleSheet, ActivityIndicator } from "react-native";
import { Wordmark } from "../components/Wordmark";
import { useTheme, type Palette } from "../lib/theme";

export function Splash() {
  const c = useTheme();
  const styles = makeStyles(c);
  return (
    <View style={styles.root}>
      <Wordmark size={72} />
      <Text style={styles.tag}>Ahorra. Disfruta. Apoya local.</Text>
      <ActivityIndicator color={c.pink} style={{ marginTop: 24 }} />
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    root: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: c.bg },
    tag: { marginTop: 14, color: c.gray, fontSize: 14, fontWeight: "700" }
  });
