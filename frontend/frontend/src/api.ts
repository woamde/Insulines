import { Platform } from "react-native";
import Constants from "expo-constants";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { loadToken } from "@/src/session";
import type {
  ActivityEntry,
  CgmStatus,
  Food,
  GlucoseReading,
  InsulinDose,
  MealEntry,
  ProfileData,
  Reminder,
  SharedView,
  ShareLink,
  StatsData,
  WeightEntry,
} from "@/src/types";

const CONFIGURED_BACKEND = Constants.expoConfig?.extra?.backendUrl ?? process.env.EXPO_PUBLIC_BACKEND_URL ?? "";

// Un export web statique buildé (ex. servi par Caddy sur glycosoin.home.arpa, à la
// même origine que l'API) peut légitimement se replier sur sa propre origine. Mais
// en développement (npx expo start), cette origine est celle de Metro — jamais votre
// backend — donc ce repli est désormais désactivé dans ce cas précis : sans lui,
// on évite d'envoyer tous les appels vers le bundler et de provoquer des erreurs
// "JSON.parse" très confuses à diagnostiquer (le middleware de Metro n'est pas fait
// pour recevoir ces requêtes).
const CAN_FALL_BACK_TO_OWN_ORIGIN = !__DEV__ && Platform.OS === "web" && typeof window !== "undefined";
const BACKEND_URL = CONFIGURED_BACKEND || (CAN_FALL_BACK_TO_OWN_ORIGIN ? window.location.origin : "");

if (__DEV__ && !BACKEND_URL) {
  console.error(
    "[api] EXPO_PUBLIC_BACKEND_URL n'est pas défini. Créez frontend/.env avec, par exemple :\n" +
      "EXPO_PUBLIC_BACKEND_URL=https://glycosoin.home.arpa\n" +
      "puis relancez `npx expo start`. Sans ça, tous les appels API échouent silencieusement."
  );
}

export const API_URL = `${BACKEND_URL.replace(/\/$/, "")}/api`;

/** Hôte du serveur, affiché dans les messages d'erreur réseau pour diagnostiquer une build mal configurée. */
export function apiHost(): string {
  return BACKEND_URL.replace(/^https?:\/\//, "").split("/")[0] || "URL du serveur non configurée";
}

export function networkError(): Error {
  return new Error(`Serveur injoignable (${apiHost()}) : vérifiez votre connexion internet`);
}

// Jeton de session partagé, défini par l'AuthContext.
let authToken: string | null = null;
let onUnauthorized: (() => void) | null = null;

export function setAuthToken(token: string | null) {
  authToken = token;
}

export function setUnauthorizedHandler(fn: (() => void) | null) {
  onUnauthorized = fn;
}

// Si la variable de module a été perdue (rechargement à chaud, redémarrage partiel),
// on relit le jeton persistant avant d'appeler le serveur.
async function resolveToken(): Promise<string | null> {
  if (!authToken) authToken = await loadToken();
  return authToken;
}

/** Lit le corps d'une réponse en JSON sans jamais lever d'exception si ce n'est pas du JSON valide. */
async function safeJson(res: Response): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await res.json();
    return body !== null && typeof body === "object"
      ? (body as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  if (Platform.OS === "web" && typeof navigator !== "undefined" && !navigator.onLine) {
    throw new Error("Hors connexion : aucune saisie n’a été enregistrée. Reconnectez-vous au serveur puis réessayez.");
  }
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init?.headers as Record<string, string>),
  };
  const token = await resolveToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, { ...init, headers });
  } catch {
    throw networkError();
  }
  if (res.status === 401) {
    const body = await safeJson(res);
    const rawDetail = typeof body?.detail === "string" ? body.detail : "";
    authToken = null;
    if (onUnauthorized) onUnauthorized();
    throw new Error(`Votre session a expiré (${rawDetail || "401"}) : reconnectez-vous avec Google`);
  }
  if (!res.ok) {
    const body = await safeJson(res);
    const detail = typeof body?.detail === "string" ? body.detail : `Erreur ${res.status}`;
    throw new Error(detail);
  }
  const data = await safeJson(res);
  if (data === null) {
    throw new Error("Réponse du serveur invalide (contenu non JSON).");
  }
  return data as T;
}

async function authHeaders(): Promise<Record<string, string>> {
  const token = await resolveToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export function fileUrl(path: string): string {
  return `${API_URL}/files/${path}`;
}

export async function uploadMealPhoto(uri: string, name = "photo.jpg"): Promise<string> {
  const form = new FormData();
  if (Platform.OS === "web") {
    const blob = await (await fetch(uri)).blob();
    form.append("file", blob, name);
  } else {
    const ext = uri.split(".").pop()?.toLowerCase() ?? "jpg";
    form.append("file", {
      uri,
      name: `photo.${ext}`,
      type: ext === "png" ? "image/png" : "image/jpeg",
    } as unknown as Blob);
  }
  const res = await fetch(`${API_URL}/upload`, { method: "POST", body: form, headers: await authHeaders() });
  if (res.status === 401) {
    if (onUnauthorized) onUnauthorized();
    throw new Error("Votre session a expiré : reconnectez-vous avec Google");
  }
  if (!res.ok) throw new Error("Échec de l'envoi de la photo");
  const data = await safeJson(res);
  if (!data) throw new Error("Réponse du serveur invalide lors de l'envoi de la photo.");
  return data.path as string;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------
export function useProfile() {
  return useQuery({
    queryKey: ["profile"],
    queryFn: () => apiFetch<ProfileData>("/profile"),
  });
}

export function useSaveProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (profile: Partial<ProfileData>) =>
      apiFetch<ProfileData>("/profile", { method: "PUT", body: JSON.stringify(profile) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["profile"] }),
  });
}

export function useGlucose(limit = 200) {
  return useQuery({
    queryKey: ["glucose", limit],
    queryFn: () => apiFetch<GlucoseReading[]>(`/glucose?limit=${limit}`),
  });
}

export function useAddGlucose() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: { value_mgdl: number; context: string; note: string }) =>
      apiFetch<GlucoseReading>("/glucose", { method: "POST", body: JSON.stringify(payload) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["glucose"] });
      qc.invalidateQueries({ queryKey: ["stats"] });
    },
  });
}

export function useDeleteGlucose() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch<{ ok: boolean }>(`/glucose/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["glucose"] });
      qc.invalidateQueries({ queryKey: ["stats"] });
    },
  });
}

export function useMeals(limit = 200) {
  return useQuery({
    queryKey: ["meals", limit],
    queryFn: () => apiFetch<MealEntry[]>(`/meals?limit=${limit}`),
  });
}

export function useAddMeal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: Partial<MealEntry>) =>
      apiFetch<MealEntry>("/meals", { method: "POST", body: JSON.stringify(payload) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["meals"] });
      qc.invalidateQueries({ queryKey: ["stats"] });
    },
  });
}

export function useDeleteMeal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch<{ ok: boolean }>(`/meals/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["meals"] });
      qc.invalidateQueries({ queryKey: ["stats"] });
    },
  });
}

export function useStats(days: number) {
  return useQuery({
    queryKey: ["stats", days],
    queryFn: () => apiFetch<StatsData>(`/stats?days=${days}`),
  });
}

export function useCgmStatus() {
  return useQuery({
    queryKey: ["cgm"],
    queryFn: () => apiFetch<CgmStatus>("/cgm/status"),
  });
}

export function useCgmSync() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<{ inserted: number; total: number }>("/cgm/sync", { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["glucose"] });
      qc.invalidateQueries({ queryKey: ["stats"] });
      qc.invalidateQueries({ queryKey: ["cgm"] });
    },
  });
}

export function useTestCgmSettings() {
  return useMutation({
    mutationFn: (payload: { source: string; region: string; username: string; password: string; nightscout_url: string; token: string; patient_id?: string }) =>
      apiFetch<{ ok: boolean; readings: number; patients: { id: string; name: string }[]; selected_patient: string; latest_value: number | null; latest_at: string | null; message: string }>("/cgm/test", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
  });
}

export function useSaveCgmSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: {
      source: string;
      region: string;
      username: string;
      password: string;
      nightscout_url: string;
      token: string;
    }) => apiFetch<CgmStatus>("/cgm/settings", { method: "POST", body: JSON.stringify(payload) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cgm"] }),
  });
}

export function useDisconnectCgm() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<{ ok: boolean }>("/cgm/settings", { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cgm"] }),
  });
}

export function useFoods() {
  return useQuery({
    queryKey: ["foods"],
    queryFn: () => apiFetch<Food[]>("/foods"),
    staleTime: 1000 * 60 * 60,
  });
}

// ---------------------------------------------------------------------------
// Insuline (basale / bolus) & poids & rappels
// ---------------------------------------------------------------------------
export function useInsulin(limit = 200) {
  return useQuery({
    queryKey: ["insulin", limit],
    queryFn: () => apiFetch<InsulinDose[]>(`/insulin?limit=${limit}`),
  });
}

export function useAddInsulin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: { units: number; kind: InsulinDose["kind"]; insulin_name: string; note: string; injected_at?: string }) =>
      apiFetch<InsulinDose>("/insulin", { method: "POST", body: JSON.stringify(payload) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["insulin"] });
      qc.invalidateQueries({ queryKey: ["stats"] });
    },
  });
}

export function useDeleteInsulin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch<{ ok: boolean }>(`/insulin/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["insulin"] });
      qc.invalidateQueries({ queryKey: ["stats"] });
    },
  });
}

export function useWeights(limit = 200) {
  return useQuery({
    queryKey: ["weight", limit],
    queryFn: () => apiFetch<WeightEntry[]>(`/weight?limit=${limit}`),
  });
}

export function useAddWeight() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: { weight_kg: number; note: string }) =>
      apiFetch<WeightEntry>("/weight", { method: "POST", body: JSON.stringify(payload) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["weight"] });
      qc.invalidateQueries({ queryKey: ["stats"] });
      qc.invalidateQueries({ queryKey: ["profile"] });
    },
  });
}

export function useDeleteWeight() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch<{ ok: boolean }>(`/weight/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["weight"] });
      qc.invalidateQueries({ queryKey: ["stats"] });
    },
  });
}

export function useReminders() {
  return useQuery({
    queryKey: ["reminders"],
    queryFn: () => apiFetch<{ reminders: Reminder[] }>("/reminders"),
  });
}

export function useSaveReminders() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (reminders: Reminder[]) =>
      apiFetch<{ reminders: Reminder[] }>("/reminders", { method: "PUT", body: JSON.stringify({ reminders }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["reminders"] }),
  });
}

// ---------------------------------------------------------------------------
// Activité physique & partage proche
// ---------------------------------------------------------------------------
export function useActivities(limit = 100) {
  return useQuery({
    queryKey: ["activity", limit],
    queryFn: () => apiFetch<ActivityEntry[]>(`/activity?limit=${limit}`),
  });
}

export function useAddActivity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: { activity_type: string; duration_min: number; intensity: string; note: string; started_at?: string }) =>
      apiFetch<ActivityEntry>("/activity", { method: "POST", body: JSON.stringify(payload) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["activity"] });
      qc.invalidateQueries({ queryKey: ["stats"] });
    },
  });
}

export function useDeleteActivity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch<{ ok: boolean }>(`/activity/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["activity"] });
      qc.invalidateQueries({ queryKey: ["stats"] });
    },
  });
}

export function useShareLinks() {
  return useQuery({ queryKey: ["share"], queryFn: () => apiFetch<ShareLink[]>("/share") });
}

export function useCreateShareLink() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: { label: string; alert_email: string }) => apiFetch<ShareLink>("/share", { method: "POST", body: JSON.stringify(payload) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["share"] }),
  });
}

export function useUpdateShareLink() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: { id: string; alert_email: string }) =>
      apiFetch<{ ok: boolean; alert_email: string }>(`/share/${payload.id}`, { method: "PATCH", body: JSON.stringify({ alert_email: payload.alert_email }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["share"] }),
  });
}

export interface ImportResult {
  readings_parsed: number;
  readings_inserted: number;
  insulin_inserted: number;
  meals_inserted: number;
  skipped: number;
}

/** Envoie un lot de lignes CSV LibreView (l'en-tête est répété dans chaque lot). */
export function importLibreviewBatch(lines: string[], batchIndex: number): Promise<ImportResult> {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Paris";
  return apiFetch<ImportResult>("/import/libreview", { method: "POST", body: JSON.stringify({ lines, tz, batch_index: batchIndex }) });
}

export function useRevokeShareLink() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch<{ ok: boolean }>(`/share/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["share"] }),
  });
}

/** Vue publique (sans connexion) pour un proche. Rafraîchie toutes les 2 minutes. */
export function useSharedView(token: string) {
  return useQuery({
    queryKey: ["shared", token],
    queryFn: async () => {
      const res = await fetch(`${API_URL}/shared/${encodeURIComponent(token)}`);
      if (!res.ok) {
        const body = await safeJson(res);
        const detail = typeof body?.detail === "string" ? body.detail : "Ce lien de partage n'est plus valide";
        throw new Error(detail);
      }
      const data = await safeJson(res);
      if (!data) throw new Error("Réponse du serveur invalide pour ce lien de partage.");
      return data as unknown as SharedView;
    },
    enabled: token.length > 0,
    refetchInterval: 120_000,
    retry: false,
  });
}

export function shareUrl(token: string): string {
  return `${BACKEND_URL.replace(/\/$/, "")}/proche/${token}`;
}

export function reportUrl(days: number): string {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Paris";
  return `${API_URL}/report/pdf?days=${days}&tz=${encodeURIComponent(tz)}`;
}

export async function reportAuthHeaders(): Promise<Record<string, string>> {
  return authHeaders();
}

export function useSendReportEmail() {
  return useMutation({
    mutationFn: (days: number) => {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Paris";
      return apiFetch<{ ok: boolean; to: string; days: number }>(`/report/email?days=${days}&tz=${encodeURIComponent(tz)}`, { method: "POST" });
    },
  });
}

// ---------------------------------------------------------------------------
// IA (Claude / Gemini)
// ---------------------------------------------------------------------------
export interface AiModel {
  key: string;
  label: string;
  provider: string;
}

export interface AiMessage {
  role: "user" | "assistant";
  content: string;
  created_at?: string;
}

export function useAiModels() {
  return useQuery({
    queryKey: ["ai-models"],
    queryFn: () => apiFetch<{ default: string; models: AiModel[] }>("/ai/models"),
    staleTime: 1000 * 60 * 60,
  });
}

export function useAiMessages() {
  return useQuery({
    queryKey: ["ai-messages"],
    queryFn: () => apiFetch<AiMessage[]>("/ai/messages"),
  });
}

export function useAiChat() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: { message: string; model: string }) =>
      apiFetch<{ reply: string }>("/ai/chat", { method: "POST", body: JSON.stringify(payload) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ai-messages"] }),
  });
}

export function useClearAiMessages() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<{ ok: boolean }>("/ai/messages", { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ai-messages"] }),
  });
}

export interface MealAnalysis {
  items: { name: string; grams: number; carbs_g: number }[];
  total_carbs_g: number;
  confidence: string;
  note: string;
}

export async function analyzeMealPhoto(imageBase64: string): Promise<MealAnalysis> {
  return apiFetch<MealAnalysis>("/ai/analyze-meal", {
    method: "POST",
    body: JSON.stringify({ image_base64: imageBase64 }),
  });
}

export interface WeeklySummary {
  summary: string;
  stats: {
    count: number;
    avg: number;
    tir: number;
    hypo: number;
    hyper: number;
    carbs_total: number;
    insulin_total: number;
  };
}

export interface CoachReport {
  days: number;
  model: string;
  model_label: string;
  created_at: string;
  report: {
    overview: string;
    insulin: string[];
    food: string[];
    activity: string[];
    patterns: string[];
    doctor_questions: string[];
    alert: string;
  };
}

export function useCoach() {
  return useMutation({
    mutationFn: (p: { days: number; model: string }) => apiFetch<CoachReport>(`/ai/coach?days=${p.days}&model=${encodeURIComponent(p.model)}`),
  });
}

export function useWeeklySummary() {
  return useMutation({
    mutationFn: () => apiFetch<WeeklySummary>("/ai/weekly-summary"),
  });
}
