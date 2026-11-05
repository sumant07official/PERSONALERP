import { DarkTheme, DefaultTheme, NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import type { Session } from "@supabase/supabase-js";
import { useEffect, useState } from "react";
import { ActivityIndicator, useColorScheme, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { supabase } from "./src/lib/supabase";
import { DrawerProvider, navigationRef, type RootStackParamList } from "./src/navigation";
import { ToastProvider } from "./src/components/ui";
import { AccountsScreen } from "./src/screens/AccountsScreen";
import { DashboardScreen } from "./src/screens/DashboardScreen";
import { LedgerScreen } from "./src/screens/LedgerScreen";
import { LoginScreen } from "./src/screens/LoginScreen";
import { MastersScreen } from "./src/screens/MastersScreen";
import { TransactionsScreen } from "./src/screens/TransactionsScreen";

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function App() {
  const scheme = useColorScheme();
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [route, setRoute] = useState<string | undefined>("Dashboard");

  useEffect(() => {
    supabase().auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase().auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  return (
    <SafeAreaProvider>
      <ToastProvider>
        {session === undefined ? (
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}><ActivityIndicator size="large" color="#0f766e" /></View>
        ) : !session ? (
          <LoginScreen />
        ) : (
          <DrawerProvider key={session.user.id} currentRoute={route}>
            <NavigationContainer ref={navigationRef} theme={scheme === "dark" ? DarkTheme : DefaultTheme}
              onStateChange={() => setRoute(navigationRef.getCurrentRoute()?.name)}>
              <Stack.Navigator screenOptions={{ headerShown: false, animation: "slide_from_right" }}>
                <Stack.Screen name="Dashboard" component={DashboardScreen} />
                <Stack.Screen name="Transactions" component={TransactionsScreen} />
                <Stack.Screen name="Accounts" component={AccountsScreen} />
                <Stack.Screen name="Ledger" component={LedgerScreen} />
                <Stack.Screen name="Masters" component={MastersScreen} />
              </Stack.Navigator>
            </NavigationContainer>
          </DrawerProvider>
        )}
      </ToastProvider>
    </SafeAreaProvider>
  );
}
