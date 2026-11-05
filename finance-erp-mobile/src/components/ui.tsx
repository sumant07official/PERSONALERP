import DateTimePicker, { DateTimePickerAndroid } from "@react-native-community/datetimepicker";
import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  ActivityIndicator, Animated, FlatList, KeyboardAvoidingView, Modal, Platform, Pressable, RefreshControl, ScrollView,
  StyleSheet, Text, TextInput, View, type TextInputProps, type TextStyle, type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { fmtDate, ymd } from "../lib/format";
import { useColors, type Colors } from "../theme";

// ---------- Text ----------
export function T({ children, style, muted, size = 14, weight, tone, numberOfLines }:
  { children: ReactNode; style?: TextStyle; muted?: boolean; size?: number; weight?: "400" | "500" | "600" | "700";
    tone?: "success" | "danger" | "warning" | "primary"; numberOfLines?: number }) {
  const c = useColors();
  const color = tone ? c[tone] : muted ? c.muted : c.text;
  return <Text numberOfLines={numberOfLines} style={[{ color, fontSize: size, fontWeight: weight }, style]}>{children}</Text>;
}

// ---------- Layout ----------
export function Card({ children, style, onPress }: { children: ReactNode; style?: ViewStyle; onPress?: () => void }) {
  const c = useColors();
  const base = { backgroundColor: c.surface, borderColor: c.border, borderWidth: 1, borderRadius: 10, padding: 12 };
  return onPress
    ? <Pressable onPress={onPress} style={({ pressed }) => [base, pressed && { opacity: 0.7 }, style]}>{children}</Pressable>
    : <View style={[base, style]}>{children}</View>;
}
export const Row = ({ children, style }: { children: ReactNode; style?: ViewStyle }) =>
  <View style={[{ flexDirection: "row", alignItems: "center", gap: 8 }, style]}>{children}</View>;

export function ScreenScroll({ children, onRefresh, refreshing = false }:
  { children: ReactNode; onRefresh?: () => void; refreshing?: boolean }) {
  const c = useColors();
  return (
    <ScrollView style={{ flex: 1, backgroundColor: c.bg }} contentContainerStyle={{ padding: 12, gap: 10, paddingBottom: 96 }}
      keyboardShouldPersistTaps="handled"
      refreshControl={onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[c.primary]} /> : undefined}>
      {children}
    </ScrollView>
  );
}

// ---------- Button ----------
export function Button({ title, onPress, variant = "secondary", busy, disabled, style, small }:
  { title: string; onPress: () => void; variant?: "primary" | "secondary" | "danger" | "ghost"; busy?: boolean; disabled?: boolean; style?: ViewStyle; small?: boolean }) {
  const c = useColors();
  const bg = { primary: c.primary, secondary: c.surface, danger: c.danger, ghost: "transparent" }[variant];
  const fg = { primary: c.primaryFg, secondary: c.text, danger: "#fff", ghost: c.primary }[variant];
  return (
    <Pressable onPress={onPress} disabled={disabled || busy}
      style={({ pressed }) => [{ height: small ? 32 : 42, paddingHorizontal: small ? 10 : 14, borderRadius: 8, backgroundColor: bg,
        borderWidth: variant === "secondary" ? 1 : 0, borderColor: c.border, alignItems: "center", justifyContent: "center",
        flexDirection: "row", gap: 6, opacity: disabled ? 0.45 : pressed ? 0.75 : 1 }, style]}>
      {busy && <ActivityIndicator size="small" color={fg} />}
      <Text style={{ color: fg, fontWeight: "600", fontSize: small ? 12 : 14 }}>{title}</Text>
    </Pressable>
  );
}

// ---------- Badge / Pill ----------
export function Badge({ label, tone = "neutral" }: { label: string; tone?: "neutral" | "success" | "danger" | "warning" | "primary" }) {
  const c = useColors();
  const map = { neutral: [c.surface2, c.muted], success: [c.successSoft, c.success], danger: [c.dangerSoft, c.danger],
    warning: [c.warningSoft, c.warning], primary: [c.primarySoft, c.primary] } as const;
  const [bg, fg] = map[tone];
  return <View style={{ backgroundColor: bg, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2, alignSelf: "flex-start" }}>
    <Text style={{ color: fg, fontSize: 11, fontWeight: "600" }}>{label}</Text></View>;
}
export function Pills<V extends string>({ options, value, onChange, multi }:
  { options: { value: V; label: string }[]; value: V | V[]; onChange: (v: V) => void; multi?: boolean }) {
  const c = useColors();
  const isOn = (v: V) => (multi ? (value as V[]).includes(v) : value === v);
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
      {options.map((o) => (
        <Pressable key={o.value} onPress={() => onChange(o.value)}
          style={{ borderWidth: 1, borderRadius: 16, paddingHorizontal: 12, height: 30, justifyContent: "center",
            borderColor: isOn(o.value) ? c.primary : c.border, backgroundColor: isOn(o.value) ? c.primarySoft : c.surface }}>
          <Text style={{ fontSize: 12, fontWeight: "600", color: isOn(o.value) ? c.primary : c.muted }}>{o.label}</Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

// ---------- Fields ----------
export function Field({ label, hint, children, style }: { label: string; hint?: string; children: ReactNode; style?: ViewStyle }) {
  return (
    <View style={[{ gap: 4 }, style]}>
      <T size={12} muted weight="500">{label}</T>
      {children}
      {hint ? <T size={11} muted>{hint}</T> : null}
    </View>
  );
}
const fieldStyle = (c: Colors): TextStyle => ({ height: 44, borderWidth: 1, borderColor: c.border, borderRadius: 8,
  backgroundColor: c.surface, color: c.text, paddingHorizontal: 10, fontSize: 15 });
export function Input(p: TextInputProps) {
  const c = useColors();
  return <TextInput placeholderTextColor={c.muted} {...p} style={[fieldStyle(c), p.multiline && { height: 80, textAlignVertical: "top", paddingTop: 10 }, p.style]} />;
}

/** Tap-to-choose field that opens a searchable bottom-sheet list. */
export function Select<V extends string>({ value, onChange, options, placeholder = "Select", title, allowEmpty }:
  { value: V | ""; onChange: (v: V | "") => void; options: { value: V; label: string; sub?: string }[]; placeholder?: string; title?: string; allowEmpty?: string }) {
  const c = useColors();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const current = options.find((o) => o.value === value);
  const list = options.filter((o) => o.label.toLowerCase().includes(q.toLowerCase()));
  return (
    <>
      <Pressable onPress={() => { setQ(""); setOpen(true); }} style={[fieldStyle(c), { justifyContent: "center" }]}>
        <Text style={{ color: current ? c.text : c.muted, fontSize: 15 }} numberOfLines={1}>{current?.label ?? (value === "" && allowEmpty ? allowEmpty : placeholder)}</Text>
      </Pressable>
      <Sheet open={open} onClose={() => setOpen(false)} title={title ?? placeholder} noScroll>
        {options.length > 8 && <Input placeholder="Search" value={q} onChangeText={setQ} style={{ marginBottom: 8 }} />}
        <FlatList data={allowEmpty ? [{ value: "" as V, label: allowEmpty }, ...list] : list} keyExtractor={(o) => o.value || "__none"}
          keyboardShouldPersistTaps="handled" style={{ maxHeight: 420 }}
          renderItem={({ item }) => (
            <Pressable onPress={() => { onChange(item.value); setOpen(false); }}
              style={{ paddingVertical: 12, paddingHorizontal: 4, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: c.border }}>
              <Text style={{ color: item.value === value ? c.primary : c.text, fontWeight: item.value === value ? "700" : "400", fontSize: 15 }}>{item.label}</Text>
              {"sub" in item && item.sub ? <Text style={{ color: c.muted, fontSize: 12 }}>{item.sub}</Text> : null}
            </Pressable>
          )} />
      </Sheet>
    </>
  );
}

/** Date field using the native Android dialog (YYYY-MM-DD in/out). */
export function DateField({ value, onChange, clearable }: { value: string; onChange: (v: string) => void; clearable?: boolean }) {
  const c = useColors();
  const [iosOpen, setIosOpen] = useState(false);
  const date = value ? new Date(value + "T00:00:00") : new Date();
  const open = () => {
    if (Platform.OS === "android") {
      DateTimePickerAndroid.open({ value: date, mode: "date", onChange: (e, d) => { if (e.type === "set" && d) onChange(ymd(d)); } });
    } else setIosOpen(true);
  };
  return (
    <>
      <Row>
        <Pressable onPress={open} style={[fieldStyle(c), { flex: 1, justifyContent: "center" }]}>
          <Text style={{ color: value ? c.text : c.muted, fontSize: 15 }}>{value ? fmtDate(value) : "Choose date"}</Text>
        </Pressable>
        {clearable && value ? <Button small variant="ghost" title="Clear" onPress={() => onChange("")} /> : null}
      </Row>
      {iosOpen && <DateTimePicker value={date} mode="date" display="inline" onChange={(_, d) => { setIosOpen(false); if (d) onChange(ymd(d)); }} />}
    </>
  );
}

// ---------- Bottom sheet / full-screen form ----------
export function Sheet({ open, onClose, title, children, footer, full, noScroll }:
  { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; full?: boolean; noScroll?: boolean }) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={open} transparent={!full} animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
        {!full && <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.45)" }} onPress={onClose} />}
        <View style={[{ backgroundColor: c.bg, paddingBottom: insets.bottom }, full ? { flex: 1, paddingTop: insets.top } : { borderTopLeftRadius: 16, borderTopRightRadius: 16, maxHeight: "90%" }]}>
          <Row style={{ height: 52, paddingHorizontal: 16, borderBottomWidth: 1, borderColor: c.border, justifyContent: "space-between" }}>
            <T size={16} weight="600" style={{ flex: 1 }} numberOfLines={1}>{title}</T>
            <Pressable onPress={onClose} hitSlop={12}><Text style={{ color: c.muted, fontSize: 20 }}>✕</Text></Pressable>
          </Row>
          {noScroll ? <View style={{ padding: 16 }}>{children}</View> : (
            <ScrollView style={full ? { flex: 1 } : undefined} contentContainerStyle={{ padding: 16, gap: 12 }} keyboardShouldPersistTaps="handled">{children}</ScrollView>
          )}
          {footer && <Row style={{ padding: 12, borderTopWidth: 1, borderColor: c.border, justifyContent: "flex-end" }}>{footer}</Row>}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ---------- States ----------
export const Loading = () => { const c = useColors(); return <View style={{ padding: 40 }}><ActivityIndicator color={c.primary} size="large" /></View>; };
export function Empty({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return <Card style={{ alignItems: "center", paddingVertical: 28, gap: 6 }}><T weight="600">{title}</T>{hint ? <T muted size={13} style={{ textAlign: "center" }}>{hint}</T> : null}{action}</Card>;
}
export function ErrorText({ message }: { message: string }) {
  const c = useColors();
  return <View style={{ backgroundColor: c.dangerSoft, borderRadius: 8, padding: 10 }}><Text style={{ color: c.danger }}>{message}</Text></View>;
}
export function Metric({ label, value, tone, hint, onPress }: { label: string; value: string; tone?: "success" | "danger" | "warning"; hint?: string; onPress?: () => void }) {
  return <Card onPress={onPress} style={{ flex: 1, minWidth: "46%" }}><T size={12} muted>{label}</T><T size={18} weight="700" tone={tone}>{value}</T>{hint ? <T size={11} muted>{hint}</T> : null}</Card>;
}
export function ProgressBar({ pct, tone = "primary" }: { pct: number; tone?: "primary" | "danger" | "warning" | "success" }) {
  const c = useColors();
  return <View style={{ height: 8, borderRadius: 4, backgroundColor: c.surface2, overflow: "hidden" }}>
    <View style={{ height: "100%", width: `${Math.max(0, Math.min(pct, 100))}%`, backgroundColor: c[tone] }} /></View>;
}

// ---------- Toasts ----------
type ToastFn = (kind: "ok" | "err", text: string) => void;
const ToastCtx = createContext<ToastFn>(() => {});
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }: { children: ReactNode }) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const opacity = useRef(new Animated.Value(0)).current;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const push = useCallback<ToastFn>((kind, text) => {
    setMsg({ kind, text });
    if (timer.current) clearTimeout(timer.current);
    Animated.timing(opacity, { toValue: 1, duration: 150, useNativeDriver: true }).start();
    timer.current = setTimeout(() => Animated.timing(opacity, { toValue: 0, duration: 250, useNativeDriver: true }).start(() => setMsg(null)),
      kind === "err" ? 6000 : 3000);
  }, [opacity]);
  const value = useMemo(() => push, [push]);
  return (
    <ToastCtx value={value}>
      {children}
      {msg && (
        <Animated.View pointerEvents="none" style={{ position: "absolute", left: 16, right: 16, bottom: insets.bottom + 24, opacity,
          backgroundColor: msg.kind === "ok" ? c.success : c.danger, borderRadius: 10, padding: 12, elevation: 6 }}>
          <Text style={{ color: "#fff", fontWeight: "500" }}>{msg.text}</Text>
        </Animated.View>
      )}
    </ToastCtx>
  );
}

/** Floating "+" button. */
export function Fab({ onPress, label = "+" }: { onPress: () => void; label?: string }) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  return (
    <Pressable onPress={onPress} style={({ pressed }) => ({ position: "absolute", right: 18, bottom: insets.bottom + 18, height: 56, minWidth: 56,
      paddingHorizontal: label.length > 1 ? 18 : 0, borderRadius: 28, backgroundColor: c.primary, alignItems: "center", justifyContent: "center",
      elevation: 6, opacity: pressed ? 0.8 : 1 })}>
      <Text style={{ color: c.primaryFg, fontSize: label.length > 1 ? 15 : 28, fontWeight: "600" }}>{label}</Text>
    </Pressable>
  );
}
