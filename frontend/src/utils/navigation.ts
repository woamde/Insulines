// src/utils/navigation.ts
import { router } from "expo-router";

/**
 * Revient en arrière de manière sécurisée.
 * Si aucun historique n'existe, redirige vers l'accueil des onglets.
 */
export function safeGoBack(fallbackPath: string = "/(tabs)") {
  if (router.canGoBack()) {
    router.back();
  } else {
    router.replace(fallbackPath as any);
  }
}