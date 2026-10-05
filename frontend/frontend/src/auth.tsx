import { Platform } from "react-native";
import * as WebBrowser from "expo-web-browser";
import * as Linking from "expo-linking";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { clearToken, loadToken, persistToken } from "@/src/session";
import { API_URL, apiHost, apiFetch, setAuthToken } from "@/src/api";
import { queryClient } from "@/src/query-client";
import { clearAccountDeviceData } from "@/src/account-cleanup";

WebBrowser.maybeCompleteAuthSession();

// --- Mobile (temporaire) : circuit Emergent, en attendant expo-auth-session -----
const AUTH_BASE = "https://auth.emergentagent.com";

// --- Web : votre propre client Google OAuth -------------------------------------
const GOOGLE_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID ?? "";
const GOOGLE_AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_STATE_KEY = "glycosoin_oauth_state";

if (__DEV__ && Platform.OS === "web" && !GOOGLE_CLIENT_ID) {
  console.error(
    "[auth] EXPO_PUBLIC_GOOGLE_CLIENT_ID n'est pas défini. Ajoutez-le dans frontend/.env " +
      "(l'ID client, jamais le secret) après avoir créé votre client OAuth Google."
  );
}

function generateState(): string {
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  }
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function buildGoogleAuthUrl(redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    access_type: "offline",
    prompt: "select_account",
    state,
  });
  return `${GOOGLE_AUTH_ENDPOINT}?${params.toString()}`;
}

function extractGoogleCallback(url: string | null): { code: string; state: string } | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    const code = u.searchParams.get("code");
    const state = u.searchParams.get("state");
    if (code && state) return { code, state };
  } catch {
    /* URL invalide, rien à extraire */
  }
  return null;
}

export interface AuthUser {
  user_id: string;
  email: string;
  name: string;
  picture: string;
  account_deletion_pending?: boolean;
}

interface AuthState {
  user: AuthUser | null;
  loading: boolean;
  signingIn: boolean;
  signIn: () => Promise<{ status: "ok" | "cancelled" | "failed"; error: string | null }>;
  signOut: () => Promise<void>;
  deleteAccount: () => Promise<void>;
  deletionNotice: string | null;
}

const AuthContext = createContext<AuthState>({
  user: null,
  loading: true,
  signingIn: false,
  signIn: async () => ({ status: "failed", error: null }),
  signOut: async () => {},
  deleteAccount: async () => {},
  deletionNotice: null,
});

export const useAuth = () => useContext(AuthContext);

const getToken = loadToken;
const saveToken = persistToken;
const removeToken = clearToken;

// Utilisé uniquement par le circuit mobile (Emergent), temporairement.
function extractSessionId(url: string | null): string | null {
  if (!url) return null;
  const match = url.match(/[?#&]session_id=([^&#]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [signingIn, setSigningIn] = useState(false);
  const [deletionNotice, setDeletionNotice] = useState<string | null>(null);
  const lastErrorRef = useRef<string | null>(null);
  const setLastError = (v: string | null) => {
    lastErrorRef.current = v;
  };
  // Un même code/session_id peut arriver deux fois (deep link + retour du navigateur) :
  // on partage la promesse pour que les deux appelants obtiennent le vrai résultat.
  const inflight = useRef<Map<string, Promise<boolean>>>(new Map());
  const capturedUrl = useRef<string | null>(null);

  // Mobile (Emergent, temporaire).
  const exchangeSession = useCallback((sessionId: string): Promise<boolean> => {
    const pending = inflight.current.get(sessionId);
    if (pending) return pending;
    const run = async (): Promise<boolean> => {
      let res: Response;
      try {
        res = await fetch(`${API_URL}/auth/session`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ session_id: sessionId }),
        });
      } catch {
        setLastError(`Serveur injoignable (${apiHost()}) : vérifiez votre connexion internet`);
        return false;
      }
      if (!res.ok) {
        let detail = `Erreur serveur ${res.status}`;
        try {
          const body = await res.json();
          if (typeof body?.detail === "string") detail = `${body.detail} (${res.status})`;
        } catch {
          /* corps non JSON */
        }
        setLastError(detail);
        return false;
      }
      const data = await res.json();
      if (typeof data?.session_token !== "string" || !data.session_token) {
        setLastError("Réponse du serveur invalide (jeton manquant)");
        return false;
      }
      await saveToken(data.session_token);
      setAuthToken(data.session_token);
      setLastError(null);
      setUser(data.user as AuthUser);
      return true;
    };
    const promise = run();
    inflight.current.set(sessionId, promise);
    return promise;
  }, []);

  // Web (votre client Google, direct).
  const exchangeGoogleCode = useCallback((code: string, redirectUri: string): Promise<boolean> => {
    const key = `${code}:${redirectUri}`;
    const pending = inflight.current.get(key);
    if (pending) return pending;
    const run = async (): Promise<boolean> => {
      let res: Response;
      try {
        res = await fetch(`${API_URL}/auth/google/callback`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code, redirect_uri: redirectUri }),
        });
      } catch {
        setLastError(`Serveur injoignable (${apiHost()}) : vérifiez votre connexion internet`);
        return false;
      }
      if (!res.ok) {
        let detail = `Erreur serveur ${res.status}`;
        try {
          const body = await res.json();
          if (typeof body?.detail === "string") detail = `${body.detail} (${res.status})`;
        } catch {
          /* corps non JSON */
        }
        setLastError(detail);
        return false;
      }
      const data = await res.json();
      if (typeof data?.session_token !== "string" || !data.session_token) {
        setLastError("Réponse du serveur invalide (jeton manquant)");
        return false;
      }
      await saveToken(data.session_token);
      setAuthToken(data.session_token);
      setLastError(null);
      setUser(data.user as AuthUser);
      return true;
    };
    const promise = run();
    inflight.current.set(key, promise);
    return promise;
  }, []);

  const checkExistingSession = useCallback(async () => {
    const token = await getToken();
    if (!token) {
      setUser(null);
      return;
    }
    setAuthToken(token);
    try {
      const res = await fetch(`${API_URL}/auth/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        setUser((await res.json()) as AuthUser);
      } else if (res.status === 401) {
        await removeToken();
        setAuthToken(null);
        setUser(null);
        queryClient.clear();
        await clearAccountDeviceData();
      } else {
        setUser(null);
      }
    } catch {
      setUser(null);
    }
  }, []);

  // Bootstrap : web = parser l'URL d'abord (code Google OU session_id legacy) ;
  // mobile = deep link froid + existant (Emergent, temporaire).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (Platform.OS === "web") {
        const url = typeof window !== "undefined" ? window.location.href : null;
        const callback = extractGoogleCallback(url);
        if (callback) {
          let expectedState: string | null = null;
          try {
            expectedState = window.sessionStorage.getItem(GOOGLE_STATE_KEY);
            window.sessionStorage.removeItem(GOOGLE_STATE_KEY);
          } catch {
            /* sessionStorage indisponible (mode privé strict, etc.) */
          }
          if (expectedState && callback.state !== expectedState) {
            setLastError("Échec de la vérification anti-CSRF (state invalide) : reconnectez-vous.");
          } else {
            const redirectUrl = window.location.origin + "/";
            const ok = await exchangeGoogleCode(callback.code, redirectUrl);
            if (ok) window.history.replaceState(window.history.state, "", redirectUrl);
          }
          if (!cancelled) setLoading(false);
          return;
        }
      } else {
        const initial = await Linking.getInitialURL();
        const sid = extractSessionId(initial) || extractSessionId(capturedUrl.current);
        if (sid) {
          await exchangeSession(sid);
          if (!cancelled) setLoading(false);
          return;
        }
      }
      await checkExistingSession();
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [exchangeGoogleCode, exchangeSession, checkExistingSession]);

  // Deep links à chaud (mobile).
  useEffect(() => {
    if (Platform.OS === "web") return;
    const sub = Linking.addEventListener("url", ({ url }) => {
      capturedUrl.current = url;
      const sid = extractSessionId(url);
      if (sid) exchangeSession(sid);
    });
    return () => sub.remove();
  }, [exchangeSession]);

  const signIn = useCallback(async (): Promise<{ status: "ok" | "cancelled" | "failed"; error: string | null }> => {
    setLastError(null);
    setDeletionNotice(null);
    setSigningIn(true);
    try {
      if (Platform.OS === "web") {
        if (!GOOGLE_CLIENT_ID) {
          return { status: "failed", error: "EXPO_PUBLIC_GOOGLE_CLIENT_ID manquant : voir frontend/.env" };
        }
        const redirectUrl = window.location.origin + "/";
        const state = generateState();
        try {
          window.sessionStorage.setItem(GOOGLE_STATE_KEY, state);
        } catch {
          /* on continue sans state persistant dans ce cas rare */
        }
        window.location.href = buildGoogleAuthUrl(redirectUrl, state);
        return { status: "ok", error: null };
      }
      // Mobile : circuit Emergent, temporaire (voir en tête de fichier).
      const redirectUrl = Linking.createURL("");
      const authUrl = `${AUTH_BASE}/?redirect=${encodeURIComponent(redirectUrl)}`;
      let result: WebBrowser.WebBrowserAuthSessionResult;
      try {
        result = await WebBrowser.openAuthSessionAsync(authUrl, redirectUrl);
      } catch {
        try {
          await Linking.openURL(authUrl);
          return { status: "ok", error: null };
        } catch {
          return { status: "failed", error: "Impossible d'ouvrir le navigateur pour la connexion Google" };
        }
      }
      let url: string | null = null;
      if (result.type === "success" && result.url) {
        url = result.url;
      }
      const sid =
        extractSessionId(url) ||
        extractSessionId(capturedUrl.current) ||
        extractSessionId(await Linking.getInitialURL());
      if (sid) {
        const ok = await exchangeSession(sid);
        return { status: ok ? "ok" : "failed", error: lastErrorRef.current };
      }
      if (result.type === "cancel" || result.type === "dismiss") {
        return { status: "cancelled", error: null };
      }
      return { status: "failed", error: lastErrorRef.current ?? `Aucun identifiant de session reçu au retour (retour attendu sur ${redirectUrl})` };
    } finally {
      setSigningIn(false);
    }
  }, [exchangeSession]);

  const clearLocalSession = useCallback(async () => {
    await removeToken();
    setAuthToken(null);
    inflight.current.clear();
    capturedUrl.current = null;
    setUser(null);
    await queryClient.cancelQueries();
    queryClient.clear();
    return clearAccountDeviceData();
  }, []);

  const signOut = useCallback(async () => {
    const token = await getToken();
    await clearLocalSession();
    if (token) {
      try {
        await fetch(`${API_URL}/auth/logout`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        });
      } catch {
        /* ignore */
      }
    }
  }, [clearLocalSession]);

  const deleteAccount = useCallback(async () => {
    const result = await apiFetch<{ ok: boolean }>("/auth/account", {
      method: "DELETE",
      body: JSON.stringify({ confirmation: "SUPPRIMER" }),
    });
    if (!result.ok) throw new Error("La suppression n'a pas été confirmée. Réessayez.");
    setDeletionNotice("Votre compte GlycoSoin et ses données ont été supprimés.");
    const cleaned = await clearLocalSession();
    if (!cleaned) setDeletionNotice("Votre compte a été supprimé. Le nettoyage local n’a pas pu être entièrement confirmé : vérifiez les rappels et fichiers de l’application sur cet appareil.");
  }, [clearLocalSession]);

  return (
    <AuthContext.Provider value={{ user, loading, signingIn, signIn, signOut, deleteAccount, deletionNotice }}>
      {children}
    </AuthContext.Provider>
  );
}
