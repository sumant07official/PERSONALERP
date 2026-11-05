import { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from "react-native";
import { configError, supabase } from "../lib/supabase";
import { Button, Card, ErrorText, Field, Input, T } from "../components/ui";
import { useColors } from "../theme";

export function LoginScreen() {
  const c = useColors();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(configError ?? "");
  const [info, setInfo] = useState("");

  async function submit() {
    setBusy(true); setError(""); setInfo("");
    try {
      if (mode === "signin") {
        const { error } = await supabase().auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;
      } else {
        const { data, error } = await supabase().auth.signUp({ email: email.trim(), password, options: { data: { full_name: name } } });
        if (error) throw error;
        if (!data.session) setInfo("Account created. Confirm your email, then sign in.");
      }
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1, backgroundColor: c.bg }}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: "center", padding: 20 }} keyboardShouldPersistTaps="handled">
        <View style={{ alignItems: "center", marginBottom: 24 }}>
          <View style={{ width: 56, height: 56, borderRadius: 16, backgroundColor: c.primary, alignItems: "center", justifyContent: "center" }}>
            <Text style={{ color: c.primaryFg, fontSize: 26, fontWeight: "700" }}>₹</Text>
          </View>
          <T size={22} weight="700" style={{ marginTop: 12 }}>Finance ERP OS</T>
          <T muted>{mode === "signin" ? "Sign in to continue" : "Create your account"}</T>
        </View>
        <Card style={{ gap: 12, padding: 16 }}>
          {mode === "signup" && <Field label="Full name"><Input value={name} onChangeText={setName} /></Field>}
          <Field label="Email"><Input value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" /></Field>
          <Field label="Password"><Input value={password} onChangeText={setPassword} secureTextEntry autoComplete="password" /></Field>
          {error ? <ErrorText message={error} /> : null}
          {info ? <T tone="success">{info}</T> : null}
          <Button variant="primary" title={mode === "signin" ? "Sign in" : "Create account"} busy={busy} disabled={!!configError} onPress={submit} />
          <Button variant="ghost" title={mode === "signin" ? "New here? Create an account" : "Have an account? Sign in"}
            onPress={() => { setMode(mode === "signin" ? "signup" : "signin"); setError(configError ?? ""); setInfo(""); }} />
        </Card>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
