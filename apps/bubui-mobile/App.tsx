import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { useEffect, useState } from "react";
import { StatusBar } from "expo-status-bar";
import { Splash } from "./src/screens/Splash";
import { Onboarding } from "./src/screens/Onboarding";
import { Feed } from "./src/screens/Feed";
import { Descubre } from "./src/screens/Descubre";
import { Mapa } from "./src/screens/Mapa";
import { Cuenta } from "./src/screens/Cuenta";
import { Afiliados } from "./src/screens/Afiliados";
import { Scan } from "./src/screens/Scan";
import { Negocio, type NegocioParam } from "./src/screens/Negocio";
import { CheckSession } from "./src/lib/session";
import { ErrorBoundary } from "./src/components/ErrorBoundary";
import { useAppFonts, applyPoppinsToTextDefaults } from "./src/lib/fonts";

// Parche de Text aplicado al evaluar el módulo, antes del primer render.
applyPoppinsToTextDefaults();

export type RootStackParamList = {
  Splash: undefined;
  Onboarding: undefined;
  Feed: undefined;
  Descubre: undefined;
  Mapa: undefined;
  Cuenta: undefined;
  Afiliados: undefined;
  Scan: { businessId: string };
  Negocio: NegocioParam;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

const linking = {
  prefixes: ["bubui://", "https://hub.negociovivo.app"],
  config: {
    screens: {
      Scan: "bubui/scan/:businessId"
    }
  }
};

export default function App() {
  const [initial, setInitial] = useState<keyof RootStackParamList | null>(null);
  const [fontsLoaded] = useAppFonts();

  useEffect(() => {
    (async () => {
      const session = await CheckSession();
      setInitial(session ? "Feed" : "Onboarding");
    })();
  }, []);

  // Splash hasta que las fuentes carguen — evita ver Roboto un frame y
  // luego cambiar a Poppins (FOIT).
  if (!initial || !fontsLoaded) return <Splash />;

  return (
    <ErrorBoundary>
      <NavigationContainer linking={linking}>
        <StatusBar style="dark" />
        <Stack.Navigator initialRouteName={initial} screenOptions={{ headerShown: false, animation: "fade" }}>
          <Stack.Screen name="Splash" component={Splash} />
          <Stack.Screen name="Onboarding" component={Onboarding} />
          <Stack.Screen name="Feed" component={Feed} />
          <Stack.Screen name="Descubre" component={Descubre} />
          <Stack.Screen name="Mapa" component={Mapa} />
          <Stack.Screen name="Cuenta" component={Cuenta} />
          <Stack.Screen name="Afiliados" component={Afiliados} />
          <Stack.Screen name="Scan" component={Scan} />
          <Stack.Screen name="Negocio" component={Negocio} />
        </Stack.Navigator>
      </NavigationContainer>
    </ErrorBoundary>
  );
}
