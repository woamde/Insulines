// src/api.ts
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

// ==========================================
// 1. IMPORT LIBREVIEW
// ==========================================
export interface ImportResult {
  readings_parsed: number;
  readings_inserted: number;
  insulin_inserted: number;
  meals_inserted: number;
  skipped: number;
}

export async function importLibreviewBatch(
  lines: string[],
  batchIndex: number
): Promise<ImportResult> {
  const response = await fetch("http://localhost:8000/api/import/libreview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ lines, batchIndex }),
  });
  if (!response.ok) throw new Error("Erreur lors de l'importation du lot LibreView");
  return response.json();
}

// ==========================================
// 2. PROFIL UTILISATEUR
// ==========================================
export interface Profile {
  name?: string;
  email?: string;
  [key: string]: any;
}

export function useProfile() {
  return useQuery({
    queryKey: ["profile"],
    queryFn: async (): Promise<Profile> => {
      const response = await fetch("http://localhost:8000/api/profile");
      if (!response.ok) throw new Error("Impossible de récupérer le profil");
      return response.json();
    },
  });
}

export function useSaveProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (profileData: Profile) => {
      const response = await fetch("http://localhost:8000/api/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(profileData),
      });
      if (!response.ok) throw new Error("Erreur lors de la sauvegarde du profil");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["profile"] });
    },
  });
}

// ==========================================
// 3. GLYCÉMIE & STATS
// ==========================================
export function useGlucose(limit?: number) {
  return useQuery({
    queryKey: ["glucose", limit],
    queryFn: async () => {
      const url = limit ? `http://localhost:8000/api/glucose?limit=${limit}` : "http://localhost:8000/api/glucose";
      const response = await fetch(url);
      if (!response.ok) throw new Error("Impossible de récupérer les glycémies");
      return response.json();
    },
  });
}

export function useStats() {
  return useQuery({
    queryKey: ["stats"],
    queryFn: async () => {
      const response = await fetch("http://localhost:8000/api/stats");
      if (!response.ok) throw new Error("Impossible de récupérer les statistiques");
      return response.json();
    },
  });
}

// ==========================================
// 4. SUIVI DU POIDS (AVEC TOUS LES ALIAS)
// ==========================================
export function useWeightHistory() {
  return useQuery({
    queryKey: ["weight"],
    queryFn: async () => {
      const response = await fetch("http://localhost:8000/api/weight");
      if (!response.ok) throw new Error("Impossible de récupérer l'historique du poids");
      return response.json();
    },
  });
}

// Alias pour compatibilité avec ajouter-insuline.tsx ou autres écrans
export function useWeights() {
  return useWeightHistory();
}

export function useAddWeight() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (weightData: { weight_kg: number; date?: string }) => {
      const response = await fetch("http://localhost:8000/api/weight", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(weightData),
      });
      if (!response.ok) throw new Error("Erreur lors de l'enregistrement du poids");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["weight"] });
      queryClient.invalidateQueries({ queryKey: ["profile"] });
    },
  });
}

export function useDeleteWeight() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (weightId: string | number) => {
      const response = await fetch(`http://localhost:8000/api/weight/${weightId}`, {
        method: "DELETE",
      });
      if (!response.ok) throw new Error("Erreur lors de la suppression du poids");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["weight"] });
      queryClient.invalidateQueries({ queryKey: ["profile"] });
    },
  });
}