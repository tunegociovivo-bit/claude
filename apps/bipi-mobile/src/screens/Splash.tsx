import { View, Text, StyleSheet, ActivityIndicator } from "react-native";
import { Wordmark } from "../components/Wordmark";
import { colors } from "../lib/theme";

export function Splash() {
  return (
    <View style={styles.root}>
      <Wordmark size={72} />
      <Text style={styles.tag}>Ahorra. Disfruta. Apoya local.</Text>
      <ActivityIndicator color={colors.pink} style={{ marginTop: 24 }} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: colors.white },
  tag: { marginTop: 14, color: colors.gray, fontSize: 14, fontWeight: "700" }
});
