import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { useEffect, useState } from "react";
import { StatusBar } from "expo-status-bar";
import * as Linking from "expo-linking";
import { Splash } from "./src/screens/Splash";
import { Onboarding } from "./src/screens/Onboarding";
import { Feed } from "./src/screens/Feed";
import { Scan } from "./src/screens/Scan";
import { CheckSession } from "./src/lib/session";

export type RootStackParamList = {
  Splash: undefined;
  Onboarding: undefined;
  Feed: undefined;
  Scan: { businessId: string };
};

const Stack = createNativeStackNavigator<RootStackParamList>();

const linking = {
  prefixes: ["bipi://", "https://hub.negociovivo.app"],
  config: {
    screens: {
      Scan: "bipi/scan/:businessId"
    }
  }
};

export default function App() {
  const [initial, setInitial] = useState<keyof RootStackParamList | null>(null);

  useEffect(() => {
    (async () => {
      const session = await CheckSession();
      setInitial(session ? "Feed" : "Onboarding");
    })();
  }, []);

  if (!initial) return <Splash />;

  return (
    <NavigationContainer linking={linking}>
      <StatusBar style="dark" />
      <Stack.Navigator initialRouteName={initial} screenOptions={{ headerShown: false }}>
        <Stack.Screen name="Splash" component={Splash} />
        <Stack.Screen name="Onboarding" component={Onboarding} />
        <Stack.Screen name="Feed" component={Feed} />
        <Stack.Screen name="Scan" component={Scan} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
