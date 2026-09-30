import { Platform } from "react-native";

import { storage } from "@/src/utils/storage";

// Un seul endroit lit/écrit le jeton de session : AuthContext (écriture) et le client API (lecture).
const TOKEN_KEY = "glycosoin_session_token";

export async function loadToken(): Promise<string | null> {
  if (Platform.OS === "web") {
    try {
      return window.localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  }
  const value = await storage.secureGet(TOKEN_KEY, "");
  return value ? value : null;
}

export async function persistToken(token: string): Promise<void> {
  if (Platform.OS === "web") {
    try {
      window.localStorage.setItem(TOKEN_KEY, token);
    } catch {
      /* ignore */
    }
    return;
  }
  await storage.secureSet(TOKEN_KEY, token);
}

export async function clearToken(): Promise<void> {
  if (Platform.OS === "web") {
    try {
      window.localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* ignore */
    }
    return;
  }
  await storage.secureRemove(TOKEN_KEY);
}
