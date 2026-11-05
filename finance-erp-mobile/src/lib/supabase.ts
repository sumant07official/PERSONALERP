import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import * as aesjs from "aes-js";
import { getRandomBytes } from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import { AppState } from "react-native";

/**
 * Session storage (Supabase's "LargeSecureStore" pattern): SecureStore holds only a
 * 256-bit key (it has a 2 KB limit); the session itself is AES-encrypted in AsyncStorage.
 */
class LargeSecureStore {
  private async encrypt(key: string, value: string) {
    const encryptionKey = getRandomBytes(256 / 8);
    const cipher = new aesjs.ModeOfOperation.ctr(encryptionKey, new aesjs.Counter(1));
    const encrypted = cipher.encrypt(aesjs.utils.utf8.toBytes(value));
    await SecureStore.setItemAsync(key, aesjs.utils.hex.fromBytes(encryptionKey));
    return aesjs.utils.hex.fromBytes(encrypted);
  }
  private async decrypt(key: string, value: string) {
    const hexKey = await SecureStore.getItemAsync(key);
    if (!hexKey) return null;
    const cipher = new aesjs.ModeOfOperation.ctr(aesjs.utils.hex.toBytes(hexKey), new aesjs.Counter(1));
    return aesjs.utils.utf8.fromBytes(cipher.decrypt(aesjs.utils.hex.toBytes(value)));
  }
  async getItem(key: string) {
    const encrypted = await AsyncStorage.getItem(key);
    return encrypted ? this.decrypt(key, encrypted) : null;
  }
  async setItem(key: string, value: string) {
    await AsyncStorage.setItem(key, await this.encrypt(key, value));
  }
  async removeItem(key: string) {
    await AsyncStorage.removeItem(key);
    await SecureStore.deleteItemAsync(key);
  }
}

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const key = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
export const configError = !url || !key
  ? "Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY in .env"
  : null;

const client: SupabaseClient = createClient(url ?? "https://missing.supabase.co", key ?? "missing", {
  auth: { storage: new LargeSecureStore(), autoRefreshToken: true, persistSession: true, detectSessionInUrl: false },
});

// Refresh tokens only while the app is in the foreground.
AppState.addEventListener("change", (state) => {
  if (state === "active") client.auth.startAutoRefresh();
  else client.auth.stopAutoRefresh();
});

export const supabase = () => client;
export const finance = () => client.schema("finance");
export const reports = () => client.schema("reports");
export const masters = () => client.schema("masters");
