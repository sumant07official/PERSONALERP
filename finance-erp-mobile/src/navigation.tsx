import { createNavigationContainerRef } from "@react-navigation/native";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Animated, BackHandler, Dimensions, Pressable, ScrollView, StatusBar, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { currentProfile } from "./lib/api";
import { supabase } from "./lib/supabase";
import { useColors } from "./theme";

export type RootStackParamList = {
  Dashboard: undefined;
  Transactions: undefined;
  Accounts: undefined;
  Ledger: { id: string; name: string };
  CreditCards: undefined;
  Commitments: undefined;
  CommitmentDetail: { id: string; name: string };
  Planning: undefined;
  Goals: undefined;
  Reports: undefined;
  Calendar: undefined;
  Assets: undefined;
  Tasks: undefined;
  Import: undefined;
  Masters: undefined;
};
export type RouteName = keyof RootStackParamList;
export const navigationRef = createNavigationContainerRef<RootStackParamList>();

type MenuItem = { route: RouteName; label: string; icon: string; soon?: boolean; ownerOnly?: boolean };
export const MENU: { group: string; items: MenuItem[] }[] = [
  { group: "Overview", items: [{ route: "Dashboard", label: "Dashboard", icon: "▦" }, { route: "Calendar", label: "Calendar", icon: "▣", soon: true }] },
  { group: "Money", items: [
    { route: "Transactions", label: "Transactions", icon: "⇄" },
    { route: "Accounts", label: "Accounts", icon: "▤" },
    { route: "CreditCards", label: "Credit cards", icon: "▭", soon: true },
  ] },
  { group: "Planning", items: [
    { route: "Planning", label: "Monthly plan", icon: "◷", soon: true },
    { route: "Commitments", label: "Commitments", icon: "↻", soon: true },
    { route: "Goals", label: "Goals", icon: "◎", soon: true },
  ] },
  { group: "More", items: [
    { route: "Reports", label: "Reports", icon: "▥", soon: true },
    { route: "Assets", label: "Assets", icon: "◆", soon: true },
    { route: "Tasks", label: "Tasks", icon: "✓", soon: true },
    { route: "Import", label: "Import", icon: "⇪", soon: true, ownerOnly: true },
    { route: "Masters", label: "Masters", icon: "≡", ownerOnly: true },
  ] },
];

type Profile = { full_name: string; role: string; email: string };
const DrawerCtx = createContext<{ open: () => void; profile: Profile | null }>({ open: () => {}, profile: null });
export const useDrawer = () => useContext(DrawerCtx);

/** Custom slide-out drawer that wraps the whole navigator. */
export function DrawerProvider({ children, currentRoute }: { children: ReactNode; currentRoute: string | undefined }) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const width = Math.min(300, Dimensions.get("window").width * 0.8);
  const x = useRef(new Animated.Value(-width)).current;
  const [visible, setVisible] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);

  useEffect(() => { currentProfile().then((p) => p && setProfile(p)).catch(() => {}); }, []);
  useEffect(() => {
    if (!visible) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => { close(); return true; });
    return () => sub.remove();
  });

  const open = () => { setVisible(true); Animated.timing(x, { toValue: 0, duration: 200, useNativeDriver: true }).start(); };
  const close = () => Animated.timing(x, { toValue: -width, duration: 180, useNativeDriver: true }).start(() => setVisible(false));
  const go = (route: RouteName) => {
    close();
    if (navigationRef.isReady()) navigationRef.reset({ index: 0, routes: [{ name: route as never }] });
  };
  const signOut = async () => { close(); await supabase().auth.signOut(); };
  const isOwner = (profile?.role ?? "owner") === "owner";

  return (
    <DrawerCtx value={{ open, profile }}>
      {children}
      {visible && (
        <View style={{ position: "absolute", top: 0, bottom: 0, left: 0, right: 0 }}>
          <Animated.View style={{ position: "absolute", top: 0, bottom: 0, left: 0, right: 0, backgroundColor: "rgba(0,0,0,0.5)",
            opacity: x.interpolate({ inputRange: [-width, 0], outputRange: [0, 1] }) }}>
            <Pressable style={{ flex: 1 }} onPress={close} />
          </Animated.View>
          <Animated.View style={{ position: "absolute", top: 0, bottom: 0, left: 0, width, backgroundColor: c.drawer, transform: [{ translateX: x }],
            paddingTop: insets.top, paddingBottom: insets.bottom }}>
            <View style={{ padding: 16, borderBottomWidth: 1, borderColor: c.drawerActive }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: "#0f766e", alignItems: "center", justifyContent: "center" }}>
                  <Text style={{ color: "#fff", fontWeight: "700", fontSize: 18 }}>₹</Text>
                </View>
                <Text style={{ color: "#fff", fontWeight: "700", fontSize: 16 }}>Finance ERP OS</Text>
              </View>
              {profile && (
                <View style={{ marginTop: 14 }}>
                  <Text style={{ color: "#fff", fontWeight: "600" }}>{profile.full_name}</Text>
                  <Text style={{ color: c.headerMuted, fontSize: 12 }}>{profile.email}</Text>
                  <View style={{ marginTop: 6, alignSelf: "flex-start", backgroundColor: "#0f2f2c", borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 }}>
                    <Text style={{ color: "#2dd4bf", fontSize: 10, fontWeight: "700", letterSpacing: 1 }}>{profile.role.toUpperCase()}</Text>
                  </View>
                </View>
              )}
            </View>
            <ScrollView contentContainerStyle={{ padding: 8 }}>
              {MENU.map((g) => {
                const items = g.items.filter((i) => isOwner || !i.ownerOnly);
                if (!items.length) return null;
                return (
                  <View key={g.group} style={{ marginBottom: 8 }}>
                    <Text style={{ color: c.headerMuted, fontSize: 11, fontWeight: "700", letterSpacing: 1, paddingHorizontal: 10, paddingVertical: 6 }}>{g.group.toUpperCase()}</Text>
                    {items.map((i) => {
                      const active = currentRoute === i.route;
                      return (
                        <Pressable key={i.route} disabled={i.soon} onPress={() => go(i.route)}
                          style={{ flexDirection: "row", alignItems: "center", gap: 12, height: 44, paddingHorizontal: 10, borderRadius: 8,
                            backgroundColor: active ? c.drawerActive : "transparent", opacity: i.soon ? 0.4 : 1 }}>
                          <Text style={{ color: "#c9d1db", width: 18, textAlign: "center" }}>{i.icon}</Text>
                          <Text style={{ color: active ? "#fff" : "#c9d1db", fontWeight: active ? "700" : "500", flex: 1 }}>{i.label}</Text>
                          {i.soon && <Text style={{ color: c.headerMuted, fontSize: 10 }}>soon</Text>}
                        </Pressable>
                      );
                    })}
                  </View>
                );
              })}
              <Pressable onPress={signOut} style={{ height: 44, paddingHorizontal: 10, justifyContent: "center" }}>
                <Text style={{ color: "#fb923c", fontWeight: "600" }}>Sign out</Text>
              </Pressable>
            </ScrollView>
          </Animated.View>
        </View>
      )}
    </DrawerCtx>
  );
}

/** Dark header + screen body. `back` shows a back arrow instead of the menu button. */
export function AppFrame({ title, subtitle, back, right, children }:
  { title: string; subtitle?: string; back?: boolean; right?: ReactNode; children: ReactNode }) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { open, profile } = useDrawer();
  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <StatusBar barStyle="light-content" />
      <View style={{ backgroundColor: c.header, paddingTop: insets.top }}>
        <View style={{ height: 56, flexDirection: "row", alignItems: "center", paddingHorizontal: 8, gap: 6 }}>
          <Pressable hitSlop={10} onPress={() => (back && navigationRef.canGoBack() ? navigationRef.goBack() : open())} style={{ padding: 8 }}>
            <Text style={{ color: c.headerText, fontSize: 20 }}>{back ? "←" : "☰"}</Text>
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={{ color: c.headerText, fontSize: 17, fontWeight: "700" }} numberOfLines={1}>{title}</Text>
            {subtitle ? <Text style={{ color: c.headerMuted, fontSize: 12 }} numberOfLines={1}>{subtitle}</Text> : null}
          </View>
          {right}
          {!back && profile && (
            <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: "#0f2f2c", alignItems: "center", justifyContent: "center", marginRight: 4 }}>
              <Text style={{ color: "#2dd4bf", fontWeight: "700" }}>{profile.full_name.slice(0, 1).toUpperCase()}</Text>
            </View>
          )}
        </View>
      </View>
      {children}
    </View>
  );
}

/** Small text button for the dark header. */
export function HeaderButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable hitSlop={8} onPress={onPress} style={{ paddingHorizontal: 8, paddingVertical: 6 }}>
      <Text style={{ color: "#2dd4bf", fontWeight: "600" }}>{label}</Text>
    </Pressable>
  );
}
